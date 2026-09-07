alter table public.orders
  add column notes_revision uuid,
  add column notes_updated_by uuid references auth.users on delete set null,
  add column notes_change_kind text check (notes_change_kind in ('added', 'edited', 'removed')),
  add column notes_notification_sent_at timestamptz;

-- Derive the editor and revision from the persisted change. Clients cannot
-- forge an actor, reset a notification claim, or reuse an earlier revision.
-- New orders already have a creation alert, which includes their initial note.
create function private.protect_order_note_notification_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.notes_revision := null;
    new.notes_updated_by := null;
    new.notes_change_kind := null;
    new.notes_notification_sent_at := null;
  elsif coalesce(new.notes, '') is distinct from coalesce(old.notes, '') then
    new.notes_revision := gen_random_uuid();
    new.notes_updated_by := actor_id;
    new.notes_change_kind := case
      when btrim(coalesce(new.notes, '')) = '' then 'removed'
      when btrim(coalesce(old.notes, '')) = '' then 'added'
      else 'edited'
    end;
    new.notes_notification_sent_at := null;
  elsif actor_id is not null then
    new.notes_revision := old.notes_revision;
    new.notes_updated_by := old.notes_updated_by;
    new.notes_change_kind := old.notes_change_kind;
    new.notes_notification_sent_at := old.notes_notification_sent_at;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_order_note_notification_fields() from public;

create trigger protect_order_note_notification_fields
before insert or update on public.orders
for each row execute function private.protect_order_note_notification_fields();
