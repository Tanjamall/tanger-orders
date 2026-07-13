alter table public.orders add column if not exists delivered_at timestamptz;

-- Existing completed orders did not previously have a delivery timestamp.
-- Use their last recorded update as the closest available historical date.
update public.orders
set delivered_at = coalesce(updated_at, created_at)
where status = 'Delivered' and delivered_at is null;

create or replace function private.set_order_delivered_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'Delivered' and (tg_op = 'INSERT' or old.status is distinct from 'Delivered') then
    new.delivered_at := coalesce(new.delivered_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'Delivered' and new.status <> 'Delivered' then
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_order_delivered_at on public.orders;
create trigger set_order_delivered_at
before insert or update on public.orders
for each row execute function private.set_order_delivered_at();
