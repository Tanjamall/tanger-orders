alter table public.orders
  add column delivered_by uuid references auth.users on delete set null,
  add column delivery_notification_sent_at timestamptz;

create index orders_delivered_by_idx
  on public.orders (delivered_by) where delivered_by is not null;

-- The authenticated member who performs the status transition is the delivery
-- actor. Client writes cannot forge either actor or either delivery claim.
-- Service-role notification claims have no auth.uid() and pass through intact.
create or replace function private.protect_order_notification_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' and actor_id is not null then
    new.created_by := actor_id;
    new.notification_sent_at := null;
    if new.status = 'Delivered' then
      new.delivered_by := actor_id;
    else
      new.delivered_by := null;
    end if;
    new.delivery_notification_sent_at := null;
  elsif tg_op = 'UPDATE' and actor_id is not null then
    new.created_by := old.created_by;
    new.notification_sent_at := old.notification_sent_at;

    if new.status = 'Delivered' and old.status is distinct from 'Delivered' then
      new.delivered_by := actor_id;
      new.delivery_notification_sent_at := null;
    elsif new.status is distinct from 'Delivered' and old.status = 'Delivered' then
      new.delivered_by := null;
      new.delivery_notification_sent_at := null;
    else
      new.delivered_by := old.delivered_by;
      new.delivery_notification_sent_at := old.delivery_notification_sent_at;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_order_notification_fields() from public;
