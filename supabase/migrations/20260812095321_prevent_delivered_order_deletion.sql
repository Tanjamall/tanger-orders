create or replace function private.prevent_delivered_order_deletion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'Delivered' then
    raise exception 'Delivered orders cannot be deleted because their stock cannot be restored';
  end if;
  return old;
end;
$$;

revoke all on function private.prevent_delivered_order_deletion() from public;

drop trigger if exists prevent_delivered_order_deletion on public.orders;
create trigger prevent_delivered_order_deletion
before delete on public.orders
for each row execute function private.prevent_delivered_order_deletion();
