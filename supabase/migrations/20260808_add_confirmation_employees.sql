-- Confirmation staff are internal workspace records, not login accounts.
create table if not exists public.confirmation_employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  bonus_per_confirmation numeric(12,2) not null default 5 check (bonus_per_confirmation >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists confirmation_employee_id uuid references public.confirmation_employees on delete set null,
  add column if not exists confirmation_bonus numeric(12,2) check (confirmation_bonus >= 0),
  add column if not exists confirmed_at timestamptz;

alter table public.confirmation_employees enable row level security;
grant select on public.confirmation_employees to authenticated;

drop policy if exists "Workspace members see confirmation employees" on public.confirmation_employees;
create policy "Workspace members see confirmation employees"
on public.confirmation_employees for select to authenticated
using (workspace_id = (select private.current_workspace_id()));

create or replace function public.create_confirmation_employee(employee_name text, employee_bonus numeric default 5)
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

  insert into public.confirmation_employees (workspace_id, name, bonus_per_confirmation)
  values (private.current_workspace_id(), trim(employee_name), greatest(coalesce(employee_bonus, 5), 0))
  returning * into created;
  return created;
end;
$$;

create or replace function public.update_confirmation_employee(employee_id uuid, employee_name text, employee_bonus numeric, employee_active boolean)
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

  update public.confirmation_employees
  set name = trim(employee_name),
      bonus_per_confirmation = greatest(coalesce(employee_bonus, 0), 0),
      active = employee_active
  where id = employee_id and workspace_id = private.current_workspace_id()
  returning * into updated;

  if not found then raise exception 'Confirmation employee not found in this workspace'; end if;
  return updated;
end;
$$;

revoke all on function public.create_confirmation_employee(text, numeric), public.update_confirmation_employee(uuid, text, numeric, boolean) from public;
grant execute on function public.create_confirmation_employee(text, numeric), public.update_confirmation_employee(uuid, text, numeric, boolean) to authenticated;

create or replace function private.set_order_confirmation_details()
returns trigger
language plpgsql
set search_path = public
as $$
declare employee_bonus numeric;
begin
  if new.status in ('Confirmed', 'Preparing', 'Out for delivery', 'Delivered') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
    if new.confirmation_employee_id is null then
      new.confirmation_bonus := 0;
    else
      select bonus_per_confirmation into employee_bonus
      from public.confirmation_employees
      where id = new.confirmation_employee_id and workspace_id = new.workspace_id;
      if employee_bonus is null then raise exception 'Confirmation employee does not belong to this workspace'; end if;
      new.confirmation_bonus := coalesce(new.confirmation_bonus, employee_bonus);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists set_order_confirmation_details on public.orders;
create trigger set_order_confirmation_details
before insert or update on public.orders
for each row execute function private.set_order_confirmation_details();

alter publication supabase_realtime add table public.confirmation_employees;
