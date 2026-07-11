-- Tanger Orders: run this in the Supabase SQL Editor after creating a project.
-- This schema keeps all business data private to signed-in members of the same workspace.
create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique default encode(gen_random_bytes(5), 'hex'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  workspace_id uuid references public.workspaces on delete set null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  low_stock_at integer not null default 3 check (low_stock_at >= 0),
  components jsonb,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_name text not null,
  phone text not null,
  address text not null,
  location_url text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  status text not null default 'New' check (status in ('New','Confirmed','Preparing','Out for delivery','Delivered','Cancelled')),
  payment_status text not null default 'Pay on delivery' check (payment_status in ('Pay on delivery','Paid','Unpaid')),
  assigned_to uuid references public.profiles on delete set null,
  delivery_charge numeric(12,2) not null default 0 check (delivery_charge >= 0),
  other_expense numeric(12,2) not null default 0 check (other_expense >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Team member')); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Kept outside the exposed public schema. It only ever returns the caller's own workspace.
create or replace function private.current_workspace_id() returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;
revoke all on function private.current_workspace_id() from public;
grant execute on function private.current_workspace_id() to authenticated;

-- A user may create a workspace once, then share the short code with their partner.
create or replace function public.create_workspace(workspace_name text) returns public.workspaces language plpgsql security definer set search_path = public as $$
declare created public.workspaces;
begin
  if auth.uid() is null or private.current_workspace_id() is not null then raise exception 'Workspace already exists for this account'; end if;
  insert into public.workspaces(name) values (workspace_name) returning * into created;
  update public.profiles set workspace_id = created.id where id = auth.uid() and workspace_id is null;
  return created;
end; $$;
create or replace function public.join_workspace(code text) returns void language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if auth.uid() is null or private.current_workspace_id() is not null then raise exception 'This account is already in a workspace'; end if;
  select id into target_id from public.workspaces where join_code = lower(code);
  if target_id is null then raise exception 'Invalid workspace code'; end if;
  update public.profiles set workspace_id = target_id where id = auth.uid() and workspace_id is null;
end; $$;

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
grant select, insert, update, delete on public.workspaces, public.profiles, public.products, public.orders to authenticated;
revoke insert, update, delete on public.workspaces, public.profiles from authenticated;
revoke all on function public.create_workspace(text), public.join_workspace(text) from public;
grant execute on function public.create_workspace(text), public.join_workspace(text) to authenticated;

create policy "Members see their workspace" on public.workspaces for select to authenticated using (id = (select private.current_workspace_id()));
create policy "Members see profiles in their workspace" on public.profiles for select to authenticated using (workspace_id = (select private.current_workspace_id()));
create policy "Members manage products" on public.products for all to authenticated using (workspace_id = (select private.current_workspace_id())) with check (workspace_id = (select private.current_workspace_id()));
create policy "Members manage orders" on public.orders for all to authenticated using (workspace_id = (select private.current_workspace_id())) with check (workspace_id = (select private.current_workspace_id()));

-- Stock is changed only when delivery status crosses the Delivered boundary. A cancelled or reopened
-- delivered order restores its stock, so accidental status changes do not corrupt inventory.
create or replace function private.change_stock(order_items jsonb, target_workspace uuid, direction integer) returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; part jsonb; item_product products%rowtype; required_qty integer;
begin
  for item in select * from jsonb_array_elements(order_items) loop
    select * into item_product from products where id = (item ->> 'productId')::uuid and workspace_id = target_workspace;
    if not found then raise exception 'An order item does not belong to this workspace'; end if;
    if item_product.components is null then
      required_qty := (item ->> 'quantity')::integer;
      update products set stock = stock + (direction * required_qty) where id = item_product.id and (direction > 0 or stock >= required_qty);
      if not found then raise exception 'Not enough stock for %', item_product.name; end if;
    else
      for part in select * from jsonb_array_elements(item_product.components) loop
        required_qty := ((item ->> 'quantity')::integer) * ((part ->> 'quantity')::integer);
        update products set stock = stock + (direction * required_qty) where id = (part ->> 'productId')::uuid and workspace_id = target_workspace and (direction > 0 or stock >= required_qty);
        if not found then raise exception 'Not enough stock for a bundle component'; end if;
      end loop;
    end if;
  end loop;
end; $$;
create or replace function private.apply_delivery_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'Delivered' then perform private.change_stock(new.items, new.workspace_id, -1); end if;
  if tg_op = 'UPDATE' and old.status <> 'Delivered' and new.status = 'Delivered' then perform private.change_stock(new.items, new.workspace_id, -1); end if;
  if tg_op = 'UPDATE' and old.status = 'Delivered' and new.status <> 'Delivered' then perform private.change_stock(old.items, old.workspace_id, 1); end if;
  if tg_op = 'UPDATE' and old.status = 'Delivered' and new.status = 'Delivered' and old.items is distinct from new.items then perform private.change_stock(old.items, old.workspace_id, 1); perform private.change_stock(new.items, new.workspace_id, -1); end if;
  new.updated_at = now(); return new;
end; $$;
create trigger apply_order_delivery_stock before insert or update on public.orders for each row execute procedure private.apply_delivery_stock();

alter publication supabase_realtime add table public.products, public.orders;
