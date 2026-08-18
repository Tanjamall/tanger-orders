-- Store one Web Push subscription per signed-in device. Each member can only
-- manage their own devices, and subscriptions stay scoped to a workspace.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint, workspace_id)
);

create index push_subscriptions_workspace_user_idx
  on public.push_subscriptions (workspace_id, user_id);
create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy "Members see their notification devices"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Members add their notification devices"
  on public.push_subscriptions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members membership
      where membership.workspace_id = push_subscriptions.workspace_id
        and membership.user_id = (select auth.uid())
    )
  );

create policy "Members update their notification devices"
  on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members membership
      where membership.workspace_id = push_subscriptions.workspace_id
        and membership.user_id = (select auth.uid())
    )
  );

create policy "Members remove their notification devices"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.orders
  add column created_by uuid references auth.users on delete set null,
  add column notification_sent_at timestamptz;

create index orders_created_by_idx
  on public.orders (created_by) where created_by is not null;

-- Attribution is taken from the authenticated database session instead of
-- trusting a user-supplied id. Notification claims can only be changed by the
-- server-side sender, whose service credential has no auth.uid().
create or replace function private.protect_order_notification_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
    new.notification_sent_at := null;
  elsif tg_op = 'UPDATE' and auth.uid() is not null then
    new.created_by := old.created_by;
    new.notification_sent_at := old.notification_sent_at;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_order_notification_fields() from public;

create trigger protect_order_notification_fields
before insert or update on public.orders
for each row execute function private.protect_order_notification_fields();
