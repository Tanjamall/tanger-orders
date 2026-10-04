create table public.daily_delivery_costs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cost_date date not null,
  amount numeric(12,2) not null check (amount >= 0 and amount <> 'NaN'::numeric),
  primary key (workspace_id, cost_date)
);

alter table public.daily_delivery_costs enable row level security;
revoke all on public.daily_delivery_costs from public, anon, authenticated;
grant select, insert, update on public.daily_delivery_costs to authenticated;

create policy "Members read daily delivery costs" on public.daily_delivery_costs
  for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));
create policy "Members add daily delivery costs" on public.daily_delivery_costs
  for insert to authenticated
  with check (workspace_id = (select private.current_workspace_id()));
create policy "Members edit daily delivery costs" on public.daily_delivery_costs
  for update to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));

alter publication supabase_realtime add table public.daily_delivery_costs;
