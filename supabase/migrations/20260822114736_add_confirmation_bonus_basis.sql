alter table public.confirmation_employees
  add column bonus_basis text not null default 'per_order'
  constraint confirmation_employees_bonus_basis_check
  check (bonus_basis in ('per_order', 'per_item'));

drop function if exists public.create_confirmation_employee(text, numeric);
drop function if exists public.update_confirmation_employee(uuid, text, numeric, boolean);

create function public.create_confirmation_employee(
  employee_name text,
  employee_bonus numeric default 5,
  employee_bonus_basis text default 'per_order'
)
returns public.confirmation_employees
language plpgsql
security definer
set search_path = public
as $$
declare created public.confirmation_employees;
begin
  if auth.uid() is null or private.current_workspace_id() is null then
    raise exception 'Sign in and select a workspace first';
  end if;
  if employee_bonus_basis not in ('per_order', 'per_item') then
    raise exception 'Bonus basis must be per_order or per_item';
  end if;

  insert into public.confirmation_employees (workspace_id, name, bonus_per_confirmation, bonus_basis)
  values (
    private.current_workspace_id(),
    trim(employee_name),
    greatest(coalesce(employee_bonus, 5), 0),
    employee_bonus_basis
  )
  returning * into created;
  return created;
end;
$$;

create function public.update_confirmation_employee(
  employee_id uuid,
  employee_name text,
  employee_bonus numeric,
  employee_active boolean,
  employee_bonus_basis text default null
)
returns public.confirmation_employees
language plpgsql
security definer
set search_path = public
as $$
declare updated public.confirmation_employees;
begin
  if auth.uid() is null or private.current_workspace_id() is null then
    raise exception 'Sign in and select a workspace first';
  end if;
  if employee_bonus_basis is not null and employee_bonus_basis not in ('per_order', 'per_item') then
    raise exception 'Bonus basis must be per_order or per_item';
  end if;

  update public.confirmation_employees
  set name = trim(employee_name),
      bonus_per_confirmation = greatest(coalesce(employee_bonus, 0), 0),
      bonus_basis = coalesce(employee_bonus_basis, bonus_basis),
      active = employee_active
  where id = employee_id and workspace_id = private.current_workspace_id()
  returning * into updated;

  if not found then raise exception 'Confirmation employee not found in this workspace'; end if;
  return updated;
end;
$$;

revoke all on function public.create_confirmation_employee(text, numeric, text), public.update_confirmation_employee(uuid, text, numeric, boolean, text) from public;
grant execute on function public.create_confirmation_employee(text, numeric, text), public.update_confirmation_employee(uuid, text, numeric, boolean, text) to authenticated;

-- Snapshot the actual amount on the order. Changing an employee's rate later
-- does not rewrite historical bonuses, while changing the confirmer or item
-- quantities on a confirmed order recalculates the snapshot.
create or replace function private.set_order_confirmation_details()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  employee_bonus numeric;
  employee_bonus_basis text;
  item_quantity numeric;
  should_recalculate boolean;
begin
  if new.status in ('Confirmed', 'Out for delivery', 'Delivered') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
    if tg_op = 'INSERT' then
      should_recalculate := true;
    else
      should_recalculate := old.status not in ('Confirmed', 'Out for delivery', 'Delivered')
        or new.confirmation_employee_id is distinct from old.confirmation_employee_id
        or new.items is distinct from old.items;
    end if;

    if new.confirmation_employee_id is null then
      new.confirmation_bonus := 0;
    elsif should_recalculate then
      select bonus_per_confirmation, bonus_basis
      into employee_bonus, employee_bonus_basis
      from public.confirmation_employees
      where id = new.confirmation_employee_id and workspace_id = new.workspace_id;

      if employee_bonus is null then raise exception 'Confirmation employee does not belong to this workspace'; end if;
      if employee_bonus_basis = 'per_item' then
        select coalesce(sum(greatest(coalesce((item ->> 'quantity')::numeric, 0), 0)), 0)
        into item_quantity
        from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item;
        new.confirmation_bonus := employee_bonus * item_quantity;
      else
        new.confirmation_bonus := employee_bonus;
      end if;
    else
      new.confirmation_bonus := old.confirmation_bonus;
    end if;
  end if;
  return new;
end;
$$;
