revoke all on function public.create_confirmation_employee(text, numeric, text) from public, anon;
revoke all on function public.update_confirmation_employee(uuid, text, numeric, boolean, text) from public, anon;
grant execute on function public.create_confirmation_employee(text, numeric, text) to authenticated;
grant execute on function public.update_confirmation_employee(uuid, text, numeric, boolean, text) to authenticated;

create index if not exists confirmation_employees_workspace_id_idx
  on public.confirmation_employees (workspace_id);

create index if not exists orders_confirmation_employee_id_idx
  on public.orders (confirmation_employee_id)
  where confirmation_employee_id is not null;
