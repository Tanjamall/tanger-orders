-- All fixtures, inventory changes and notification events are rolled back.
begin;
do $$ declare u uuid; begin
  select m.user_id into u from public.workspace_members m join public.profiles p on p.id=m.user_id and p.workspace_id=m.workspace_id limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare w uuid; p uuid; o uuid; v jsonb; s integer; rejected boolean; order_lines jsonb; defs jsonb;
begin
  select private.current_workspace_id() into w;
  if w is null then raise exception 'A test workspace is required'; end if;
  insert into public.products(workspace_id,name,cost,price,stock,variants)
    values(w,'__order_items_transaction_test__',40,100,5,'[{"id":"red","label":"Red","stock":2},{"id":"black","label":"Black","stock":3}]') returning id into p;
  order_lines:=jsonb_build_array(jsonb_build_object('productId',p,'variantId','red','quantity',1,'unitPrice',100),jsonb_build_object('productId',p,'variantId','black','quantity',2,'unitPrice',90));
  insert into public.orders(workspace_id,client_name,phone,address,status,items,delivery_charge,other_expense)
    values(w,'__order_items_transaction_test__','','','Confirmed',order_lines,35,5) returning id into o;
  if (select jsonb_array_length(items) from public.orders where id=o)<>2 or (select stock from public.products where id=p)<>5 then raise exception 'Pending mixed order failed'; end if;
  update public.orders set status='Delivered' where id=o;
  select stock,variants into s,v from public.products where id=p;
  if s<>2 or (v->0->>'stock')::integer<>1 or (v->1->>'stock')::integer<>1 then raise exception 'Mixed colors were not deducted separately'; end if;
  if (select sum((item->>'costTotal')::numeric) from public.orders cross join lateral jsonb_array_elements(items) item where id=o)<>120 then raise exception 'Mixed FIFO cost is incorrect'; end if;
  if (select sum((item->>'quantity')::numeric*(item->>'unitPrice')::numeric)-sum((item->>'costTotal')::numeric)-max(delivery_charge)-max(other_expense) from public.orders cross join lateral jsonb_array_elements(items) item where id=o)<>120 then raise exception 'Order expenses charged more than once'; end if;
  update public.orders set notes='Two colors, one customer' where id=o;
  if (select stock from public.products where id=p)<>2 then raise exception 'Note edit consumed twice'; end if;
  update public.orders set items=jsonb_build_array(jsonb_build_object('productId',p,'variantId','red','quantity',2,'unitPrice',100),jsonb_build_object('productId',p,'variantId','black','quantity',1,'unitPrice',100)) where id=o;
  select stock,variants into s,v from public.products where id=p;
  if s<>2 or (v->0->>'stock')::integer<>0 or (v->1->>'stock')::integer<>2 then raise exception 'Mixed order edit did not restore previous stock'; end if;
  select variants into defs from public.products where id=p;
  perform public.save_product_variant_details(p,2,defs,jsonb_build_object('name','__order_items_transaction_test__','cost',40,'price',100,'stock',2,'lowStockAt',1,'variantName','Color','variants','[{"id":"red","label":"Red","stock":0},{"id":"black","label":"Charcoal","stock":2}]'::jsonb));
  update public.orders set items=jsonb_build_array(jsonb_build_object('productId',p,'variantId','black','quantity',1,'unitPrice',100)) where id=o;
  if (select items->0->>'variantLabel' from public.orders where id=o)<>'Black' then raise exception 'Removing an earlier line lost the surviving variant snapshot'; end if;
  select stock,variants into s,v from public.products where id=p;
  if s<>4 or (v->0->>'stock')::integer<>2 or (v->1->>'stock')::integer<>2 then raise exception 'Removing line did not restore only its units'; end if;
  rejected:=false;
  begin
    insert into public.orders(workspace_id,client_name,phone,address,status,items)
      values(w,'__order_items_transaction_test__','','','Delivered',jsonb_build_array(jsonb_build_object('productId',p,'variantId','red','quantity',2,'unitPrice',100),jsonb_build_object('productId',p,'variantId','red','quantity',1,'unitPrice',100)));
  exception when others then if sqlerrm not like 'Not enough%' and sqlerrm not like '%Only % left%' and sqlerrm not like '%Out of stock%' then raise; end if; rejected:=true; end;
  if not rejected or (select stock from public.products where id=p)<>4 then raise exception 'Combined overselling did not roll back'; end if;
  update public.orders set status='Canceled' where id=o;
  if (select stock from public.products where id=p)<>5 then raise exception 'Reopening lost a variant'; end if;
end $$;
set constraints all immediate;
rollback;
select 'Mixed order database checks passed; fixtures rolled back' as result;
