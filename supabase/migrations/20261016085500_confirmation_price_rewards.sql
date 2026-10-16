alter table public.orders
 add column confirmation_extra_bonus numeric(12,2) check (confirmation_extra_bonus>=0),
 add column confirmation_base_prices jsonb;

create or replace function private.set_order_confirmation_details() returns trigger language plpgsql set search_path='' as $$
declare employee_bonus numeric; employee_basis text; item_quantity numeric; extra_bonus numeric:=0; base_price numeric; bases jsonb:='{}'::jsonb; entry record; should_recalculate boolean; current_terms jsonb; previous_terms jsonb;
begin
 if new.status not in ('Confirmed','Out for delivery','Delivered') then
  new.confirmation_bonus:=0; new.confirmation_extra_bonus:=0; new.confirmation_base_prices:=null;
  return new;
 end if;
 new.confirmed_at:=coalesce(new.confirmed_at,now());
 select jsonb_agg(jsonb_build_array(i->>'productId',coalesce(i->>'variantId',''),(i->>'quantity')::numeric,(i->>'unitPrice')::numeric) order by i->>'productId',coalesce(i->>'variantId',''),(i->>'unitPrice')::numeric,(i->>'quantity')::numeric)
 into current_terms from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) i;
 if tg_op='INSERT' then should_recalculate:=true;
 else
  select jsonb_agg(jsonb_build_array(i->>'productId',coalesce(i->>'variantId',''),(i->>'quantity')::numeric,(i->>'unitPrice')::numeric) order by i->>'productId',coalesce(i->>'variantId',''),(i->>'unitPrice')::numeric,(i->>'quantity')::numeric)
  into previous_terms from jsonb_array_elements(coalesce(old.items,'[]'::jsonb)) i;
  should_recalculate:=old.status not in ('Confirmed','Out for delivery','Delivered') or new.confirmation_employee_id is distinct from old.confirmation_employee_id or current_terms is distinct from previous_terms;
 end if;
 if new.confirmation_employee_id is null then
  new.confirmation_bonus:=0; new.confirmation_extra_bonus:=0; new.confirmation_base_prices:=null;
 elsif should_recalculate then
  select bonus_per_confirmation,bonus_basis into employee_bonus,employee_basis from public.confirmation_employees where id=new.confirmation_employee_id and workspace_id=new.workspace_id;
  if not found then raise exception 'Confirmation employee does not belong to this workspace'; end if;
  select coalesce(sum((i->>'quantity')::numeric),0) into item_quantity from jsonb_array_elements(new.items) i;
  for entry in select value as item from jsonb_array_elements(new.items) loop
   select price into base_price from public.products where id=(entry.item->>'productId')::uuid and workspace_id=new.workspace_id;
   if not found then
    base_price:=case when tg_op='UPDATE' then (old.confirmation_base_prices->>(entry.item->>'productId'))::numeric else null end;
    base_price:=coalesce(base_price,(entry.item->>'unitPrice')::numeric);
   end if;
   bases:=bases||jsonb_build_object(entry.item->>'productId',base_price);
   extra_bonus:=extra_bonus+greatest((entry.item->>'unitPrice')::numeric-base_price,0)*(entry.item->>'quantity')::numeric;
  end loop;
  new.confirmation_extra_bonus:=round(extra_bonus,2);
  new.confirmation_base_prices:=bases;
  new.confirmation_bonus:=round(employee_bonus*case when employee_basis='per_item' then item_quantity else 1 end+extra_bonus,2);
 else
  -- Keep earned rewards stable when notes, status, costs or product catalog prices change.
  new.confirmation_bonus:=old.confirmation_bonus;
  new.confirmation_extra_bonus:=old.confirmation_extra_bonus;
  new.confirmation_base_prices:=old.confirmation_base_prices;
 end if;
 return new;
end $$;
revoke all on function private.set_order_confirmation_details() from public,anon,authenticated;
