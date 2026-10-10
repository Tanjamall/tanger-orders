-- Run through Supabase execute_sql. Every fixture and side effect is rolled back.
begin;
do $$ declare u uuid; begin
  select m.user_id into u from public.workspace_members m join public.profiles p on p.id=m.user_id and p.workspace_id=m.workspace_id limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare w uuid; u uuid; p uuid; legacy_p uuid; o uuid; legacy_o uuid; v jsonb; s integer; costs numeric; rejected boolean; defs jsonb;
begin
  select m.workspace_id,m.user_id into w,u from public.workspace_members m join public.profiles p on p.id=m.user_id and p.workspace_id=m.workspace_id limit 1;
  if w is null then raise exception 'A test workspace membership is required'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  insert into public.products(workspace_id,name,cost,price,stock,variants)
    values(w,'__variant_transaction_test__',40,100,5,'[{"id":"red","label":"Red","stock":2},{"id":"black","label":"Black","stock":3}]') returning id into p;
  insert into public.orders(workspace_id,client_name,phone,address,status,items)
    values(w,'__variant_transaction_test__','','','Confirmed',jsonb_build_array(jsonb_build_object('productId',p,'variantId','red','variantLabel','Forged','quantity',2,'unitPrice',100))) returning id into o;
  select stock,variants into s,v from public.products where id=p;
  if s<>5 or (v->0->>'stock')::integer<>2 then raise exception 'Pending order consumed stock'; end if;
  if (select items->0->>'variantLabel' from public.orders where id=o)<>'Red' then raise exception 'Variant snapshot was not validated'; end if;
  update public.orders set status='Delivered' where id=o;
  select stock,variants into s,v from public.products where id=p;
  if s<>3 or (v->0->>'stock')::integer<>0 or (v->1->>'stock')::integer<>3 then raise exception 'Delivered variant stock incorrect'; end if;
  if (select (items->0->>'costTotal')::numeric from public.orders where id=o)<>80 then raise exception 'FIFO cost changed'; end if;
  update public.orders set items=jsonb_build_array(jsonb_build_object('productId',p,'variantId','black','quantity',1,'unitPrice',100)) where id=o;
  select stock,variants into s,v from public.products where id=p;
  if s<>4 or (v->0->>'stock')::integer<>2 or (v->1->>'stock')::integer<>2 then raise exception 'Delivered edit did not restore and consume variants'; end if;
  update public.orders set notes='Metadata only' where id=o;
  if (select stock from public.products where id=p)<>4 then raise exception 'Metadata edit consumed twice'; end if;
  update public.orders set status='Canceled' where id=o;
  if (select stock from public.products where id=p)<>5 then raise exception 'Reopening did not restore stock'; end if;
  rejected:=false;
  begin
    insert into public.orders(workspace_id,client_name,phone,address,status,items)
      values(w,'__variant_transaction_test__','','','Delivered',jsonb_build_array(jsonb_build_object('productId',p,'variantId','red','quantity',3,'unitPrice',100)));
  exception when others then if sqlerrm not like 'Not enough%' then raise; end if; rejected:=true; end;
  if not rejected or (select stock from public.products where id=p)<>5 then raise exception 'Overselling did not roll back'; end if;
  rejected:=false;
  begin
    insert into public.orders(workspace_id,client_name,phone,address,status,items)
      values(w,'__variant_transaction_test__','','','New',jsonb_build_array(jsonb_build_object('productId',p,'quantity',1,'unitPrice',100)));
  exception when others then if sqlerrm not like 'Choose a%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'New order without variant was accepted'; end if;
  perform public.restock_product_variant(p,'black',2,60);
  select stock,variants into s,v from public.products where id=p;
  if s<>7 or (v->1->>'stock')::integer<>5 then raise exception 'Variant restock incorrect'; end if;
  perform set_config('app.variant_operation','',true); rejected:=false;
  begin perform public.restock_product(p,1,60);
  exception when others then if sqlerrm not like 'Choose a variant%' then raise; end if; rejected:=true; end;
  if not rejected or (select stock from public.products where id=p)<>7 then raise exception 'Generic restock corrupted variant stock'; end if;
  select variants into defs from public.products where id=p;
  perform public.save_product_variant_details(p,7,defs,jsonb_build_object('name','__variant_transaction_test__','stock',6,'cost',45,'price',100,'lowStockAt',1,'variantName','Color','variants','[{"id":"red","label":"Ruby","stock":1},{"id":"black","label":"Black","stock":5}]'::jsonb));
  if (select stock from public.products where id=p)<>6 then raise exception 'Variant correction failed'; end if;
  if (select coalesce(sum(remaining_quantity),0) from public.inventory_batches where product_id=p)<>6 then raise exception 'Correction broke FIFO totals'; end if;
  rejected:=false;
  begin perform public.save_product_variant_details(p,7,defs,jsonb_build_object('stock',7,'variants',defs));
  exception when others then if sqlerrm not like 'Stock changed%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Stale product edit overwrote stock'; end if;
  select variants into defs from public.products where id=p;
  rejected:=false;
  begin perform public.save_product_variant_details(p,6,defs,jsonb_build_object('name','x','stock',6,'cost',45,'price',100,'lowStockAt',1,'variantName','Color','variants','[{"id":"red","label":"Ruby","stock":6}]'::jsonb));
  exception when others then if sqlerrm not like 'A variant used in orders%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Historical variant removal accepted'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true); rejected:=false;
  begin perform public.restock_product_variant(p,'black',1,60);
  exception when others then if sqlerrm not like 'Product not found in your workspace%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Cross-workspace mutation accepted'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  -- A delivered order from before variants were introduced keeps its original costs.
  insert into public.products(workspace_id,name,cost,price,stock) values(w,'__variant_transaction_test_legacy__',30,100,5) returning id into legacy_p;
  insert into public.orders(workspace_id,client_name,phone,address,status,items)
    values(w,'__variant_transaction_test_legacy__','','','Delivered',jsonb_build_array(jsonb_build_object('productId',legacy_p,'quantity',1,'unitPrice',100))) returning id into legacy_o;
  perform public.save_product_variant_details(legacy_p,4,'[]',jsonb_build_object('name','__variant_transaction_test_legacy__','stock',4,'cost',30,'price',100,'lowStockAt',1,'variantName','Color','variants','[{"id":"red","label":"Red","stock":2},{"id":"black","label":"Black","stock":2}]'::jsonb));
  update public.orders set notes='Historical note only' where id=legacy_o;
  if (select (items->0->>'costTotal')::numeric from public.orders where id=legacy_o)<>30 then raise exception 'Conversion rewrote historical cost'; end if;
  update public.orders set status='New' where id=legacy_o;
  select stock,variants into s,v from public.products where id=legacy_p;
  if s<>5 or not exists(select 1 from jsonb_array_elements(v) entry where entry->>'id'='legacy' and (entry->>'stock')::integer=1) then raise exception 'Historical reopen lost unspecified stock'; end if;
  update public.orders set items=jsonb_build_array(jsonb_build_object('productId',legacy_p,'variantId','legacy','quantity',1,'unitPrice',100)),status='Delivered' where id=legacy_o;
  if (select stock from public.products where id=legacy_p)<>4 then raise exception 'Legacy stock could not be delivered again'; end if;
end $$;
set constraints all immediate;
rollback;
select 'Variant database checks passed; fixtures rolled back' as result;