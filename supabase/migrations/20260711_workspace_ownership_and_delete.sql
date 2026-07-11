alter table public.workspaces add column if not exists created_by uuid references auth.users on delete set null;
update public.workspaces w set created_by = (
  select p.id from public.profiles p where p.workspace_id = w.id order by p.created_at asc limit 1
) where w.created_by is null;
drop function if exists public.list_my_workspaces();

create or replace function public.create_workspace(workspace_name text) returns public.workspaces language plpgsql security definer set search_path = public as $$
declare created public.workspaces;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  insert into public.workspaces(name, created_by) values (workspace_name, auth.uid()) returning * into created;
  insert into public.workspace_members(workspace_id, user_id) values (created.id, auth.uid());
  update public.profiles set workspace_id = created.id where id = auth.uid();
  return created;
end; $$;

create or replace function public.list_my_workspaces() returns table(id uuid, name text, join_code text, is_owner boolean) language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.join_code, w.created_by = auth.uid() from public.workspaces w join public.workspace_members m on m.workspace_id = w.id where m.user_id = auth.uid() order by w.created_at
$$;

create or replace function public.delete_workspace(target_workspace_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare next_workspace_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.workspaces where id = target_workspace_id and created_by = auth.uid()) then raise exception 'Only the workspace creator can delete it'; end if;
  select workspace_id into next_workspace_id from public.workspace_members where user_id = auth.uid() and workspace_id <> target_workspace_id limit 1;
  update public.profiles set workspace_id = next_workspace_id where id = auth.uid();
  delete from public.workspaces where id = target_workspace_id;
end; $$;
revoke all on function public.create_workspace(text), public.list_my_workspaces(), public.delete_workspace(uuid) from public;
grant execute on function public.create_workspace(text), public.list_my_workspaces(), public.delete_workspace(uuid) to authenticated;
