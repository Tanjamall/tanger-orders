-- Store one Firebase Cloud Messaging token per installed Android app. Browser
-- Web Push subscriptions remain in push_subscriptions so both channels can be
-- delivered independently.
create table public.android_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  device_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_token, workspace_id)
);

create index android_push_devices_workspace_user_idx
  on public.android_push_devices (workspace_id, user_id);
create index android_push_devices_user_idx
  on public.android_push_devices (user_id);

alter table public.android_push_devices enable row level security;
revoke all on public.android_push_devices from anon, authenticated;
grant select, insert, update, delete on public.android_push_devices to authenticated;

create policy "Members see their Android devices"
  on public.android_push_devices for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Members add their Android devices"
  on public.android_push_devices for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members membership
      where membership.workspace_id = android_push_devices.workspace_id
        and membership.user_id = (select auth.uid())
    )
  );

create policy "Members update their Android devices"
  on public.android_push_devices for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members membership
      where membership.workspace_id = android_push_devices.workspace_id
        and membership.user_id = (select auth.uid())
    )
  );

create policy "Members remove their Android devices"
  on public.android_push_devices for delete to authenticated
  using (user_id = (select auth.uid()));
