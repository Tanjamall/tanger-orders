-- Preserve existing active workspaces, then allow each account to join many workspaces.
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
insert into public.workspace_members (workspace_id, user_id)
select workspace_id, id from public.profiles where workspace_id is not null
on conflict do nothing;
alter table public.workspace_members enable row level security;
grant select on public.workspace_members to authenticated;
create policy "Users see their own workspace memberships" on public.workspace_members for select to authenticated using (user_id = auth.uid());

create or replace function public.create_workspace(workspace_name text) returns public.workspaces language plpgsql security definer set search_path = public as $$
declare created public.workspaces;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  insert into public.workspaces(name) values (workspace_name) returning * into created;
  insert into public.workspace_members(workspace_id, user_id) values (created.id, auth.uid());
  update public.profiles set workspace_id = created.id where id = auth.uid();
  return created;
end; $$;

create or replace function public.join_workspace(code text) returns void language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select id into target_id from public.workspaces where join_code = lower(code);
  if target_id is null then raise exception 'Invalid workspace code'; end if;
  insert into public.workspace_members(workspace_id, user_id) values (target_id, auth.uid()) on conflict do nothing;
  update public.profiles set workspace_id = target_id where id = auth.uid();
end; $$;

create or replace function public.switch_workspace(target_workspace_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members where workspace_id = target_workspace_id and user_id = auth.uid()) then raise exception 'Not a member of this workspace'; end if;
  update public.profiles set workspace_id = target_workspace_id where id = auth.uid();
end; $$;

create or replace function public.list_my_workspaces() returns table(id uuid, name text, join_code text) language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.join_code from public.workspaces w join public.workspace_members m on m.workspace_id = w.id where m.user_id = auth.uid() order by w.created_at
$$;
revoke all on function public.create_workspace(text), public.join_workspace(text), public.switch_workspace(uuid), public.list_my_workspaces() from public;
grant execute on function public.create_workspace(text), public.join_workspace(text), public.switch_workspace(uuid), public.list_my_workspaces() to authenticated;
