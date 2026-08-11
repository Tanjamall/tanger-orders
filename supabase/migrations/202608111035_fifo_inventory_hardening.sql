-- Supporting indexes for FIFO foreign keys and explicit RPC access hardening.

create index if not exists inventory_batches_product_idx
  on public.inventory_batches (product_id);
create index if not exists inventory_batches_created_by_idx
  on public.inventory_batches (created_by) where created_by is not null;

create index if not exists inventory_movements_product_fk_idx
  on public.inventory_movements (product_id);
create index if not exists inventory_movements_batch_idx
  on public.inventory_movements (batch_id) where batch_id is not null;
create index if not exists inventory_movements_order_idx
  on public.inventory_movements (order_id) where order_id is not null;
create index if not exists inventory_movements_created_by_idx
  on public.inventory_movements (created_by) where created_by is not null;

create index if not exists order_cost_allocations_batch_idx
  on public.order_cost_allocations (batch_id);
create index if not exists order_cost_allocations_ordered_product_idx
  on public.order_cost_allocations (ordered_product_id);
create index if not exists order_cost_allocations_stock_product_idx
  on public.order_cost_allocations (stock_product_id);
create index if not exists order_cost_allocations_workspace_idx
  on public.order_cost_allocations (workspace_id);

revoke execute on function public.create_confirmation_employee(text, numeric) from anon;
revoke execute on function public.create_workspace(text) from anon;
revoke execute on function public.delete_workspace(uuid) from anon;
revoke execute on function public.join_workspace(text) from anon;
revoke execute on function public.list_my_workspaces() from anon;
revoke execute on function public.switch_workspace(uuid) from anon;
revoke execute on function public.update_confirmation_employee(uuid, text, numeric, boolean) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
