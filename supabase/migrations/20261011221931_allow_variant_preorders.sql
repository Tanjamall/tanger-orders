create or replace function private.validate_order_variant_availability() returns trigger language plpgsql security definer set search_path='' as $$
declare entry record; p public.products%rowtype; v jsonb; old_quantity integer; available integer;
begin
 if auth.uid() is not null and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=auth.uid()) then raise exception 'Order does not belong to your workspace'; end if;
 -- Pending orders can be taken before stock arrives. Delivery must still fit current stock.
 if new.status<>'Delivered' then return new; end if;
 for entry in select item->>'productId' as product_id,item->>'variantId' as variant_id,sum((item->>'quantity')::integer) as quantity from jsonb_array_elements(new.items) item where nullif(item->>'variantId','') is not null group by 1,2 order by 1,2 loop
  select * into p from public.products where id=entry.product_id::uuid and workspace_id=new.workspace_id for update;
  if not found then raise exception 'Product not found in this workspace'; end if;
  select value into v from jsonb_array_elements(p.variants) where value->>'id'=entry.variant_id;
  if not found then raise exception 'This variant is no longer available for %',p.name; end if;
  old_quantity:=0;
  if tg_op='UPDATE' then select coalesce(sum((item->>'quantity')::integer),0) into old_quantity from jsonb_array_elements(old.items) item where item->>'productId'=entry.product_id and item->>'variantId'=entry.variant_id; end if;
  available:=(v->>'stock')::integer;
  if tg_op='UPDATE' and old.status='Delivered' then available:=available+old_quantity; end if;
  if entry.quantity>available then
   if available=0 then raise exception '% · %: Out of stock. Choose another variant.',p.name,v->>'label'; end if;
   raise exception '% · %: Only % left. Reduce the quantity or choose another variant.',p.name,v->>'label',available;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.validate_order_variant_availability() from public,anon,authenticated;
