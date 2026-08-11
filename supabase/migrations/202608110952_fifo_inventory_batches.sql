-- FIFO inventory costing and auditable restocking.
-- Existing on-hand quantities become opening batches. Existing delivered orders
-- receive cost snapshots and reversible legacy allocations without changing stock.

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  fifo_position bigint generated always as identity unique,
  workspace_id uuid not null references public.workspaces on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  original_quantity integer not null check (original_quantity > 0),
  remaining_quantity integer not null check (remaining_quantity >= 0 and remaining_quantity <= original_quantity),
  received_at timestamptz not null default now(),
  source text not null default 'restock' check (source in ('opening_balance', 'restock', 'legacy_delivery')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_batches_fifo_idx
  on public.inventory_batches (workspace_id, product_id, received_at, fifo_position)
  where remaining_quantity > 0;

create table public.order_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  order_id uuid not null references public.orders on delete cascade deferrable initially deferred,
  order_item_index integer not null check (order_item_index >= 0),
  ordered_product_id uuid not null references public.products on delete cascade,
  stock_product_id uuid not null references public.products on delete cascade,
  batch_id uuid not null references public.inventory_batches on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create index order_cost_allocations_order_idx
  on public.order_cost_allocations (order_id, order_item_index, created_at, id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  batch_id uuid references public.inventory_batches on delete set null,
  order_id uuid references public.orders on delete set null deferrable initially deferred,
  order_item_index integer,
  movement_type text not null check (movement_type in ('opening_balance', 'restock', 'sale', 'return')),
  quantity_change integer not null check (quantity_change <> 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_movements_product_idx
  on public.inventory_movements (workspace_id, product_id, created_at desc, id);

alter table public.inventory_batches enable row level security;
alter table public.order_cost_allocations enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.inventory_batches, public.order_cost_allocations, public.inventory_movements from anon, authenticated;
grant select on public.inventory_batches, public.order_cost_allocations, public.inventory_movements to authenticated;

create policy "Members view inventory batches"
  on public.inventory_batches for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));

create policy "Members view order cost allocations"
  on public.order_cost_allocations for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));

create policy "Members view inventory movements"
  on public.inventory_movements for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));

create or replace function private.strip_item_costs(order_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item - 'costTotal' order by ordinal_position), '[]'::jsonb)
  from jsonb_array_elements(order_items) with ordinality as entries(item, ordinal_position)
$$;

create or replace function private.refresh_active_product_cost(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_cost numeric(12,2);
begin
  select batch.unit_cost
    into active_cost
  from public.inventory_batches batch
  where batch.product_id = target_product_id
    and batch.remaining_quantity > 0
  order by batch.received_at, batch.fifo_position
  limit 1;

  if active_cost is not null then
    perform set_config('app.inventory_operation', 'on', true);
    update public.products set cost = active_cost where id = target_product_id;
  end if;
end;
$$;

create or replace function private.consume_fifo(
  target_workspace_id uuid,
  target_order_id uuid,
  target_order_item_index integer,
  target_ordered_product_id uuid,
  target_stock_product_id uuid,
  required_quantity integer
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  stock_product public.products%rowtype;
  batch_record public.inventory_batches%rowtype;
  remaining integer := required_quantity;
  taken integer;
  consumed_cost numeric(14,2) := 0;
begin
  if required_quantity <= 0 then
    raise exception 'Order quantities must be greater than zero';
  end if;

  select *
    into stock_product
  from public.products
  where id = target_stock_product_id
    and workspace_id = target_workspace_id
  for update;

  if not found or stock_product.components is not null then
    raise exception 'An order item or bundle component is invalid';
  end if;

  if stock_product.stock < required_quantity then
    raise exception 'Not enough stock for %', stock_product.name;
  end if;

  for batch_record in
    select *
    from public.inventory_batches
    where workspace_id = target_workspace_id
      and product_id = target_stock_product_id
      and remaining_quantity > 0
    order by received_at, fifo_position
    for update
  loop
    exit when remaining = 0;
    taken := least(remaining, batch_record.remaining_quantity);

    update public.inventory_batches
      set remaining_quantity = remaining_quantity - taken
      where id = batch_record.id;

    insert into public.order_cost_allocations (
      workspace_id, order_id, order_item_index, ordered_product_id,
      stock_product_id, batch_id, quantity, unit_cost
    ) values (
      target_workspace_id, target_order_id, target_order_item_index, target_ordered_product_id,
      target_stock_product_id, batch_record.id, taken, batch_record.unit_cost
    );

    insert into public.inventory_movements (
      workspace_id, product_id, batch_id, order_id, order_item_index,
      movement_type, quantity_change, unit_cost, created_by
    ) values (
      target_workspace_id, target_stock_product_id, batch_record.id, target_order_id,
      target_order_item_index, 'sale', -taken, batch_record.unit_cost, auth.uid()
    );

    consumed_cost := consumed_cost + (taken * batch_record.unit_cost);
    remaining := remaining - taken;
  end loop;

  if remaining > 0 then
    raise exception 'Inventory batches are inconsistent for %', stock_product.name;
  end if;

  perform set_config('app.inventory_operation', 'on', true);
  update public.products
    set stock = stock - required_quantity
    where id = target_stock_product_id;

  perform private.refresh_active_product_cost(target_stock_product_id);
  return consumed_cost;
end;
$$;

create or replace function private.consume_order_fifo(
  target_order_id uuid,
  target_workspace_id uuid,
  order_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
  part jsonb;
  ordered_product public.products%rowtype;
  ordered_quantity integer;
  component_quantity integer;
  line_cost numeric(14,2);
  costed_items jsonb := private.strip_item_costs(order_items);
begin
  if jsonb_typeof(order_items) <> 'array' or jsonb_array_length(order_items) = 0 then
    raise exception 'An order must contain at least one item';
  end if;

  for entry in
    select item, (ordinal_position - 1)::integer as item_index
    from jsonb_array_elements(costed_items) with ordinality as entries(item, ordinal_position)
  loop
    ordered_quantity := (entry.item ->> 'quantity')::integer;
    line_cost := 0;

    select *
      into ordered_product
    from public.products
    where id = (entry.item ->> 'productId')::uuid
      and workspace_id = target_workspace_id
    for update;

    if not found then
      raise exception 'An order item does not belong to this workspace';
    end if;

    if ordered_product.components is null then
      line_cost := private.consume_fifo(
        target_workspace_id, target_order_id, entry.item_index, ordered_product.id,
        ordered_product.id, ordered_quantity
      );
    else
      if jsonb_array_length(ordered_product.components) = 0 then
        raise exception 'Bundle % has no components', ordered_product.name;
      end if;

      for part in select value from jsonb_array_elements(ordered_product.components)
      loop
        component_quantity := ordered_quantity * ((part ->> 'quantity')::integer);
        line_cost := line_cost + private.consume_fifo(
          target_workspace_id, target_order_id, entry.item_index, ordered_product.id,
          (part ->> 'productId')::uuid, component_quantity
        );
      end loop;
    end if;

    costed_items := jsonb_set(
      costed_items,
      array[entry.item_index::text, 'costTotal'],
      to_jsonb(round(line_cost, 2)),
      true
    );
  end loop;

  return costed_items;
end;
$$;

create or replace function private.restore_order_fifo(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation public.order_cost_allocations%rowtype;
  affected_product_id uuid;
begin
  perform set_config('app.inventory_operation', 'on', true);

  for allocation in
    select *
    from public.order_cost_allocations
    where order_id = target_order_id
    order by created_at, id
    for update
  loop
    update public.inventory_batches
      set remaining_quantity = remaining_quantity + allocation.quantity
      where id = allocation.batch_id
        and remaining_quantity + allocation.quantity <= original_quantity;
    if not found then
      raise exception 'Cannot restore inventory batch for order %', target_order_id;
    end if;

    update public.products
      set stock = stock + allocation.quantity
      where id = allocation.stock_product_id
        and workspace_id = allocation.workspace_id;
    if not found then
      raise exception 'Cannot restore a deleted product for order %', target_order_id;
    end if;

    insert into public.inventory_movements (
      workspace_id, product_id, batch_id, order_id, order_item_index,
      movement_type, quantity_change, unit_cost, created_by
    ) values (
      allocation.workspace_id, allocation.stock_product_id, allocation.batch_id,
      allocation.order_id, allocation.order_item_index, 'return',
      allocation.quantity, allocation.unit_cost, auth.uid()
    );
  end loop;

  for affected_product_id in
    select distinct stock_product_id
    from public.order_cost_allocations
    where order_id = target_order_id
  loop
    perform private.refresh_active_product_cost(affected_product_id);
  end loop;

  delete from public.order_cost_allocations where order_id = target_order_id;
end;
$$;

create or replace function private.guard_product_inventory_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.components is null
     and (new.stock is distinct from old.stock or new.cost is distinct from old.cost)
     and coalesce(current_setting('app.inventory_operation', true), '') <> 'on' then
    raise exception 'Use the restock action to change stock or buying cost';
  end if;
  return new;
end;
$$;

create trigger guard_product_inventory_update
before update of stock, cost on public.products
for each row execute function private.guard_product_inventory_update();

create or replace function private.initialize_product_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_batch_id uuid;
begin
  if new.components is null and new.stock > 0 then
    insert into public.inventory_batches (
      workspace_id, product_id, unit_cost, original_quantity,
      remaining_quantity, received_at, source, created_by
    ) values (
      new.workspace_id, new.id, new.cost, new.stock,
      new.stock, new.created_at, 'opening_balance', auth.uid()
    ) returning id into created_batch_id;

    insert into public.inventory_movements (
      workspace_id, product_id, batch_id, movement_type,
      quantity_change, unit_cost, created_by, created_at
    ) values (
      new.workspace_id, new.id, created_batch_id, 'opening_balance',
      new.stock, new.cost, auth.uid(), new.created_at
    );
  end if;
  return new;
end;
$$;

create trigger initialize_product_inventory
after insert on public.products
for each row execute function private.initialize_product_inventory();

create or replace function public.restock_product(
  target_product_id uuid,
  added_quantity integer,
  new_unit_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_product public.products%rowtype;
  created_batch public.inventory_batches%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if added_quantity <= 0 then
    raise exception 'Restock quantity must be greater than zero';
  end if;
  if new_unit_cost < 0 then
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
    raise exception 'Bundles are restocked through their component products';
  end if;

  insert into public.inventory_batches (
    workspace_id, product_id, unit_cost, original_quantity,
    remaining_quantity, received_at, source, created_by
  ) values (
    target_product.workspace_id, target_product.id, new_unit_cost, added_quantity,
    added_quantity, now(), 'restock', caller_id
  ) returning * into created_batch;

  insert into public.inventory_movements (
    workspace_id, product_id, batch_id, movement_type,
    quantity_change, unit_cost, created_by
  ) values (
    target_product.workspace_id, target_product.id, created_batch.id, 'restock',
    added_quantity, new_unit_cost, caller_id
  );

  perform set_config('app.inventory_operation', 'on', true);
  update public.products
    set stock = stock + added_quantity
    where id = target_product.id;
  perform private.refresh_active_product_cost(target_product.id);

  return jsonb_build_object(
    'batchId', created_batch.id,
    'productId', target_product.id,
    'addedQuantity', added_quantity,
    'unitCost', new_unit_cost,
    'newStock', target_product.stock + added_quantity
  );
end;
$$;

revoke all on function public.restock_product(uuid, integer, numeric) from public, anon;
grant execute on function public.restock_product(uuid, integer, numeric) to authenticated;

revoke all on function private.strip_item_costs(jsonb) from public;
revoke all on function private.refresh_active_product_cost(uuid) from public;
revoke all on function private.consume_fifo(uuid, uuid, integer, uuid, uuid, integer) from public;
revoke all on function private.consume_order_fifo(uuid, uuid, jsonb) from public;
revoke all on function private.restore_order_fifo(uuid) from public;
revoke all on function private.guard_product_inventory_update() from public;
revoke all on function private.initialize_product_inventory() from public;

-- Stop the legacy stock trigger before creating the batch ledger and cost snapshots.
drop trigger if exists apply_order_delivery_stock on public.orders;
drop function if exists private.apply_delivery_stock();
drop function if exists private.change_stock(jsonb, uuid, integer);

-- Every current on-hand unit becomes the oldest opening batch.
with created_batches as (
  insert into public.inventory_batches (
    workspace_id, product_id, unit_cost, original_quantity,
    remaining_quantity, received_at, source
  )
  select workspace_id, id, cost, stock, stock, now(), 'opening_balance'
  from public.products
  where components is null and stock > 0
  returning id, workspace_id, product_id, unit_cost, original_quantity, received_at
)
insert into public.inventory_movements (
  workspace_id, product_id, batch_id, movement_type,
  quantity_change, unit_cost, created_at
)
select workspace_id, product_id, id, 'opening_balance',
       original_quantity, unit_cost, received_at
from created_batches;

-- Existing delivered sales already reduced products.stock. Synthetic empty batches
-- preserve their cost and make those deliveries exactly reversible.
do $$
declare
  delivered_order public.orders%rowtype;
  entry record;
  part jsonb;
  ordered_product public.products%rowtype;
  stock_product public.products%rowtype;
  sold_quantity integer;
  line_cost numeric(14,2);
  historical_batch_id uuid;
  costed_items jsonb;
  legacy_date timestamptz;
begin
  for delivered_order in
    select * from public.orders where status = 'Delivered' order by created_at, id
  loop
    costed_items := private.strip_item_costs(delivered_order.items);
    legacy_date := coalesce(delivered_order.delivered_at, delivered_order.created_at);

    for entry in
      select item, (ordinal_position - 1)::integer as item_index
      from jsonb_array_elements(costed_items) with ordinality as entries(item, ordinal_position)
    loop
      select *
        into ordered_product
      from public.products
      where id = (entry.item ->> 'productId')::uuid
        and workspace_id = delivered_order.workspace_id;
      if not found then
        raise exception 'Cannot backfill cost for order %: product is missing', delivered_order.id;
      end if;

      line_cost := 0;
      if ordered_product.components is null then
        sold_quantity := (entry.item ->> 'quantity')::integer;

        insert into public.inventory_batches (
          workspace_id, product_id, unit_cost, original_quantity,
          remaining_quantity, received_at, source
        ) values (
          delivered_order.workspace_id, ordered_product.id, ordered_product.cost,
          sold_quantity, 0, legacy_date, 'legacy_delivery'
        ) returning id into historical_batch_id;

        insert into public.order_cost_allocations (
          workspace_id, order_id, order_item_index, ordered_product_id,
          stock_product_id, batch_id, quantity, unit_cost, created_at
        ) values (
          delivered_order.workspace_id, delivered_order.id, entry.item_index,
          ordered_product.id, ordered_product.id, historical_batch_id,
          sold_quantity, ordered_product.cost, legacy_date
        );
        line_cost := sold_quantity * ordered_product.cost;
      else
        for part in select value from jsonb_array_elements(ordered_product.components)
        loop
          select *
            into stock_product
          from public.products
          where id = (part ->> 'productId')::uuid
            and workspace_id = delivered_order.workspace_id
            and components is null;
          if not found then
            raise exception 'Cannot backfill bundle cost for order %: component is missing', delivered_order.id;
          end if;

          sold_quantity := (entry.item ->> 'quantity')::integer * (part ->> 'quantity')::integer;
          insert into public.inventory_batches (
            workspace_id, product_id, unit_cost, original_quantity,
            remaining_quantity, received_at, source
          ) values (
            delivered_order.workspace_id, stock_product.id, stock_product.cost,
            sold_quantity, 0, legacy_date, 'legacy_delivery'
          ) returning id into historical_batch_id;

          insert into public.order_cost_allocations (
            workspace_id, order_id, order_item_index, ordered_product_id,
            stock_product_id, batch_id, quantity, unit_cost, created_at
          ) values (
            delivered_order.workspace_id, delivered_order.id, entry.item_index,
            ordered_product.id, stock_product.id, historical_batch_id,
            sold_quantity, stock_product.cost, legacy_date
          );
          line_cost := line_cost + (sold_quantity * stock_product.cost);
        end loop;
      end if;

      costed_items := jsonb_set(
        costed_items,
        array[entry.item_index::text, 'costTotal'],
        to_jsonb(round(line_cost, 2)),
        true
      );
    end loop;

    update public.orders set items = costed_items where id = delivered_order.id;
  end loop;
end;
$$;

create or replace function private.apply_delivery_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'Delivered' then
      perform private.restore_order_fifo(old.id);
    end if;
    return old;
  end if;

  if auth.uid() is not null and not exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = new.workspace_id
      and membership.user_id = auth.uid()
  ) then
    raise exception 'Order does not belong to your workspace';
  end if;

  if tg_op = 'INSERT' and new.status = 'Delivered' then
    new.items := private.consume_order_fifo(new.id, new.workspace_id, new.items);
  elsif tg_op = 'INSERT' then
    new.items := private.strip_item_costs(new.items);
  elsif old.status <> 'Delivered' and new.status = 'Delivered' then
    new.items := private.consume_order_fifo(new.id, new.workspace_id, new.items);
  elsif old.status = 'Delivered' and new.status <> 'Delivered' then
    perform private.restore_order_fifo(old.id);
    new.items := private.strip_item_costs(new.items);
  elsif old.status = 'Delivered'
        and private.strip_item_costs(old.items) is distinct from private.strip_item_costs(new.items) then
    perform private.restore_order_fifo(old.id);
    new.items := private.consume_order_fifo(new.id, new.workspace_id, new.items);
  elsif new.status <> 'Delivered' then
    new.items := private.strip_item_costs(new.items);
  else
    new.items := old.items;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.apply_delivery_stock() from public;

create trigger apply_order_delivery_stock
before insert or update or delete on public.orders
for each row execute function private.apply_delivery_stock();
