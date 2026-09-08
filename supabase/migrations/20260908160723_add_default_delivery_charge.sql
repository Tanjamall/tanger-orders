alter table public.workspaces
  add column if not exists default_delivery_charge numeric(12,2) not null default 0;

alter table public.workspaces
  drop constraint if exists workspaces_default_delivery_charge_nonnegative,
  add constraint workspaces_default_delivery_charge_nonnegative
    check (default_delivery_charge >= 0);

grant update (default_delivery_charge) on public.workspaces to authenticated;

drop policy if exists "Members update workspace delivery default" on public.workspaces;
create policy "Members update workspace delivery default"
  on public.workspaces
  for update
  to authenticated
  using (id = (select private.current_workspace_id()))
  with check (id = (select private.current_workspace_id()));
