-- Restore controlled stock and active-cost editing without breaking FIFO history.

alter table public.inventory_batches
  drop constraint inventory_batches_source_check;
alter table public.inventory_batches
  add constraint inventory_batches_source_check
  check (source in ('opening_balance', 'restock', 'legacy_delivery', 'correction'));

alter table public.inventory_movements
  drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in ('opening_balance', 'restock', 'sale', 'return', 'correction'));

create table public.inventory_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  old_stock integer not null check (old_stock >= 0),
  new_stock integer not null check (new_stock >= 0),
  old_active_cost numeric(12,2) not null check (old_active_cost >= 0),
  new_active_cost numeric(12,2) not null check (new_active_cost >= 0),
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_corrections_workspace_product_idx
  on public.inventory_corrections (workspace_id, product_id, created_at desc);
create index inventory_corrections_product_idx
  on public.inventory_corrections (product_id);
create index inventory_corrections_created_by_idx
  on public.inventory_corrections (created_by) where created_by is not null;

alter table public.inventory_corrections enable row level security;
revoke all on public.inventory_corrections from anon, authenticated;
grant select on public.inventory_corrections to authenticated;

create policy "Members view inventory corrections"
  on public.inventory_corrections for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));

create or replace function public.correct_product_inventory(
  target_product_id uuid,
  corrected_stock integer,
  corrected_active_cost numeric,
  correction_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_product public.products%rowtype;
  active_batch public.inventory_batches%rowtype;
  newest_batch public.inventory_batches%rowtype;
  created_batch public.inventory_batches%rowtype;
  stock_delta integer;
  quantity_to_remove integer;
  removed_quantity integer;
  ledger_stock integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if corrected_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;
  if corrected_active_cost < 0 then
    raise exception 'Buying cost cannot be negative';
  end if;

  select product.*
    into target_product
  from public.products product
  join public.workspace_members membership
    on membership.workspace_id = product.workspace_id
   and membership.user_id = caller_id
  where product.id = target_product_id
  for update of product;

  if not found then
    raise exception 'Product not found in your workspace';
  end if;
  if target_product.components is not null then
    raise exception 'Bundle stock and cost are calculated from component products';
  end if;

  select coalesce(sum(batch.remaining_quantity), 0)::integer
    into ledger_stock
  from public.inventory_batches batch
  where batch.product_id = target_product.id;

  if ledger_stock <> target_product.stock then
    raise exception 'Inventory ledger is inconsistent for %. Refresh and try again', target_product.name;
  end if;

  select batch.*
    into active_batch
  from public.inventory_batches batch
  where batch.product_id = target_product.id
    and batch.remaining_quantity > 0
  order by batch.received_at, batch.fifo_position
  limit 1
  for update;

  if target_product.stock > 0 and not found then
    raise exception 'Active inventory batch is missing for %', target_product.name;
  end if;

  -- Correct only the unsold portion of the active batch. Historical order
  -- allocations keep their original cost snapshots.
  if active_batch.id is not null
     and active_batch.unit_cost is distinct from corrected_active_cost then
    update public.inventory_batches
      set unit_cost = corrected_active_cost
      where id = active_batch.id;
  end if;

  stock_delta := corrected_stock - target_product.stock;

  if stock_delta > 0 then
    insert into public.inventory_batches (
      workspace_id, product_id, unit_cost, original_quantity,
      remaining_quantity, received_at, source, created_by
    ) values (
      target_product.workspace_id, target_product.id, corrected_active_cost, stock_delta,
      stock_delta, now(), 'correction', caller_id
    ) returning * into created_batch;

    insert into public.inventory_movements (
      workspace_id, product_id, batch_id, movement_type,
      quantity_change, unit_cost, created_by
    ) values (
      target_product.workspace_id, target_product.id, created_batch.id, 'correction',
      stock_delta, corrected_active_cost, caller_id
    );
  elsif stock_delta < 0 then
    quantity_to_remove := -stock_delta;

    -- A correction unwinds the newest remaining quantities first so earlier
    -- FIFO layers stay in place for normal sales.
    for newest_batch in
      select batch.*
      from public.inventory_batches batch
      where batch.product_id = target_product.id
        and batch.remaining_quantity > 0
      order by batch.received_at desc, batch.fifo_position desc
      for update
    loop
      exit when quantity_to_remove = 0;
      removed_quantity := least(quantity_to_remove, newest_batch.remaining_quantity);

      update public.inventory_batches
        set remaining_quantity = remaining_quantity - removed_quantity
        where id = newest_batch.id;

      insert into public.inventory_movements (
        workspace_id, product_id, batch_id, movement_type,
        quantity_change, unit_cost, created_by
      ) values (
        target_product.workspace_id, target_product.id, newest_batch.id, 'correction',
        -removed_quantity, newest_batch.unit_cost, caller_id
      );

      quantity_to_remove := quantity_to_remove - removed_quantity;
    end loop;

    if quantity_to_remove <> 0 then
      raise exception 'Not enough inventory batches to correct %', target_product.name;
    end if;
  end if;

  insert into public.inventory_corrections (
    workspace_id, product_id, old_stock, new_stock,
    old_active_cost, new_active_cost, note, created_by
  ) values (
    target_product.workspace_id, target_product.id, target_product.stock, corrected_stock,
    target_product.cost, corrected_active_cost, nullif(trim(correction_note), ''), caller_id
  );

  perform set_config('app.inventory_operation', 'on', true);
  update public.products
    set stock = corrected_stock,
        cost = corrected_active_cost
    where id = target_product.id;

  return jsonb_build_object(
    'productId', target_product.id,
    'oldStock', target_product.stock,
    'newStock', corrected_stock,
    'oldActiveCost', target_product.cost,
    'newActiveCost', corrected_active_cost
  );
end;
$$;

revoke all on function public.correct_product_inventory(uuid, integer, numeric, text) from public, anon;
grant execute on function public.correct_product_inventory(uuid, integer, numeric, text) to authenticated;
