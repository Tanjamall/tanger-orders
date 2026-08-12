alter table public.orders drop constraint if exists orders_status_check;

update public.orders set status = 'Confirmed' where status = 'Preparing';
update public.orders set status = 'Canceled' where status = 'Cancelled';

alter table public.orders
  add constraint orders_status_check
  check (status in ('New', 'Confirmed', 'Out for delivery', 'Delivered', 'Canceled'));

create or replace function private.set_order_confirmation_details()
returns trigger
language plpgsql
set search_path = public
as $$
declare employee_bonus numeric;
begin
  if new.status in ('Confirmed', 'Out for delivery', 'Delivered') then
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
