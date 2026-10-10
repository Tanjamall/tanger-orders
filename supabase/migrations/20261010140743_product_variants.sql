-- Separate variant counts, with the existing product-level FIFO costs unchanged.
alter table public.products add column variant_name text not null default 'Color';
alter table public.products add column variants jsonb not null default '[]'::jsonb;

create function private.guard_product_variants() returns trigger language plpgsql set search_path='' as $$
declare v jsonb; seen_ids text[] := '{}'; seen_labels text[] := '{}';
begin
  if jsonb_typeof(new.variants) is distinct from 'array' or jsonb_array_length(new.variants)>100 then
    raise exception 'Variants must be a list of up to 100 options';
  end if;
  if jsonb_array_length(new.variants)>0 then
    if new.components is not null then raise exception 'Bundle options are selected through individual products'; end if;
    if trim(new.variant_name)='' or length(new.variant_name)>50 then raise exception 'Give the variant option a name'; end if;
    if exists(select 1 from public.products p cross join lateral jsonb_array_elements(p.components) part where p.workspace_id=new.workspace_id and part->>'productId'=new.id::text) then
      raise exception 'Remove this product from bundles before enabling variants';
    end if;
  end if;
  for v in select value from jsonb_array_elements(new.variants) loop
    if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'id','')='' or coalesce(trim(v->>'label'),'')='' or length(v->>'label')>100
       or jsonb_typeof(v->'stock') is distinct from 'number' or (v->>'stock')::numeric<0 or (v->>'stock')::numeric<>trunc((v->>'stock')::numeric) then
      raise exception 'Each variant needs an ID, a name and a nonnegative whole stock count';
    end if;
    if v->>'id'=any(seen_ids) or lower(trim(v->>'label'))=any(seen_labels) then raise exception 'Variant names must be different'; end if;
    seen_ids:=array_append(seen_ids,v->>'id'); seen_labels:=array_append(seen_labels,lower(trim(v->>'label')));
  end loop;
  if tg_op='UPDATE' and (new.variants is distinct from old.variants or new.variant_name is distinct from old.variant_name)
     and coalesce(current_setting('app.variant_operation',true),'')<>'on' then
    raise exception 'Use the product form to edit variants';
  end if;
  if tg_op='UPDATE' and jsonb_array_length(old.variants)>0 and new.stock is distinct from old.stock
     and coalesce(current_setting('app.variant_operation',true),'')<>'on' then raise exception 'Choose a variant before changing stock'; end if;
  if new.components is not null and exists(
    select 1 from jsonb_array_elements(new.components) part join public.products p on p.id::text=part->>'productId'
    where p.workspace_id=new.workspace_id and jsonb_array_length(p.variants)>0
  ) then raise exception 'Products with variants must be ordered individually'; end if;
  return new;
end $$;
revoke all on function private.guard_product_variants() from public,anon,authenticated;
create trigger guard_product_variants before insert or update on public.products for each row execute function private.guard_product_variants();

create function private.assert_variant_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; counted bigint;
begin
  select * into p from public.products where id=new.id;
  if found and jsonb_array_length(p.variants)>0 then
    select sum((v->>'stock')::bigint) into counted from jsonb_array_elements(p.variants) v;
    if counted<>p.stock then raise exception 'Variant quantities must add up to the product stock'; end if;
  end if;
  return null;
end $$;
revoke all on function private.assert_variant_stock() from public,anon,authenticated;
create constraint trigger assert_variant_stock after insert or update on public.products deferrable initially deferred for each row execute function private.assert_variant_stock();

create function private.adjust_order_variant_stock(order_items jsonb, target_workspace uuid, direction integer) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; p public.products%rowtype; v jsonb; updated jsonb; variant_id text; found_variant boolean; qty integer;
begin
  perform set_config('app.variant_operation','on',true);
  -- Match FIFO's row locking so counts and aggregate stock change in one transaction.
  for item in select value from jsonb_array_elements(order_items) order by value->>'productId' loop
    select * into p from public.products where id=(item->>'productId')::uuid and workspace_id=target_workspace for update;
    if not found then raise exception 'Product not found in this workspace'; end if;
    if jsonb_array_length(p.variants)=0 then continue; end if;
    qty:=(item->>'quantity')::integer; variant_id:=nullif(item->>'variantId',''); updated:='[]'::jsonb; found_variant:=false;
    if variant_id is null and direction=1 then
      variant_id:='legacy';
      if not exists(select 1 from jsonb_array_elements(p.variants) entry where entry->>'id'='legacy') then
        p.variants:=p.variants||jsonb_build_array(jsonb_build_object('id','legacy','label','Unspecified (older orders)','stock',0));
      end if;
    end if;
    for v in select value from jsonb_array_elements(p.variants) loop
      if v->>'id'=variant_id then
        found_variant:=true;
        if direction=-1 and (v->>'stock')::integer<qty then raise exception 'Not enough % stock for %',v->>'label',p.name; end if;
        v:=jsonb_set(v,'{stock}',to_jsonb((v->>'stock')::integer+direction*qty));
      end if;
      updated:=updated||jsonb_build_array(v);
    end loop;
    if not found_variant then raise exception 'Edit the order and choose a variant for % before delivery',p.name; end if;
    update public.products set variants=updated where id=p.id;
  end loop;
end $$;
revoke all on function private.adjust_order_variant_stock(jsonb,uuid,integer) from public,anon,authenticated;

create function private.prepare_order_variants(order_items jsonb, target_workspace uuid, previous_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry record; p public.products%rowtype; v jsonb; item jsonb; old_item jsonb; result jsonb:='[]'::jsonb;
begin
  for entry in select value,ordinality from jsonb_array_elements(order_items) with ordinality loop
    item:=entry.value; old_item:=previous_items->((entry.ordinality-1)::integer);
    select * into p from public.products where id=(item->>'productId')::uuid and workspace_id=target_workspace;
    if not found then
      if old_item->>'productId'=item->>'productId' and old_item->>'quantity'=item->>'quantity' and old_item->>'unitPrice'=item->>'unitPrice' then result:=result||jsonb_build_array(item); continue; end if;
      raise exception 'Product not found in this workspace';
    end if;
    if nullif(item->>'variantId','') is not null then
      select value into v from jsonb_array_elements(p.variants) where value->>'id'=item->>'variantId';
      if not found then raise exception 'This variant is no longer available for %',p.name; end if;
      if old_item->>'productId'=item->>'productId' and old_item->>'variantId'=item->>'variantId' then
        item:=item||jsonb_build_object('variantLabel',coalesce(old_item->>'variantLabel',v->>'label'),'variantName',coalesce(old_item->>'variantName',p.variant_name));
      else item:=item||jsonb_build_object('variantLabel',v->>'label','variantName',p.variant_name); end if;
    elsif jsonb_array_length(p.variants)>0 and (old_item is null or old_item->>'productId' is distinct from item->>'productId' or nullif(old_item->>'variantId','') is not null
          or old_item->>'quantity' is distinct from item->>'quantity' or old_item->>'unitPrice' is distinct from item->>'unitPrice') then
      raise exception 'Choose a % for %',p.variant_name,p.name;
    else item:=item-'variantId'-'variantLabel'-'variantName'; end if;
    result:=result||jsonb_build_array(item);
  end loop;
  return result;
end $$;
revoke all on function private.prepare_order_variants(jsonb,uuid,jsonb) from public,anon,authenticated;

create or replace function private.apply_delivery_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.status='Delivered' then
      perform private.adjust_order_variant_stock(old.items,old.workspace_id,1);
      perform private.restore_order_fifo(old.id);
    end if;
    return old;
  end if;
  if auth.uid() is not null and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=auth.uid()) then raise exception 'Order does not belong to your workspace'; end if;
  new.items:=private.prepare_order_variants(new.items,new.workspace_id,case when tg_op='UPDATE' then old.items else null end);
  if tg_op='INSERT' and new.status='Delivered' then
    perform private.adjust_order_variant_stock(new.items,new.workspace_id,-1);
    new.items:=private.consume_order_fifo(new.id,new.workspace_id,new.items);
  elsif tg_op='INSERT' then new.items:=private.strip_item_costs(new.items);
  elsif old.status<>'Delivered' and new.status='Delivered' then
    perform private.adjust_order_variant_stock(new.items,new.workspace_id,-1);
    new.items:=private.consume_order_fifo(new.id,new.workspace_id,new.items);
  elsif old.status='Delivered' and new.status<>'Delivered' then
    perform private.adjust_order_variant_stock(old.items,old.workspace_id,1);
    perform private.restore_order_fifo(old.id);
    new.items:=private.strip_item_costs(new.items);
  elsif old.status='Delivered' and private.strip_item_costs(old.items) is distinct from private.strip_item_costs(new.items) then
    perform private.adjust_order_variant_stock(old.items,old.workspace_id,1);
    perform private.restore_order_fifo(old.id);
    perform private.adjust_order_variant_stock(new.items,new.workspace_id,-1);
    new.items:=private.consume_order_fifo(new.id,new.workspace_id,new.items);
  elsif new.status<>'Delivered' then new.items:=private.strip_item_costs(new.items);
  else new.items:=old.items;
  end if;
  new.updated_at:=now(); return new;
end $$;

create function public.save_product_variant_details(target_product_id uuid, expected_stock integer, expected_variants jsonb, product_values jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; v jsonb; new_variants jsonb:=product_values->'variants'; new_stock integer:=(product_values->>'stock')::integer; counted bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select product.* into p from public.products product join public.workspace_members m on m.workspace_id=product.workspace_id and m.user_id=auth.uid() where product.id=target_product_id for update of product;
  if not found then raise exception 'Product not found in your workspace'; end if;
  if p.components is not null then raise exception 'Bundles do not have individual variant stock'; end if;
  if p.stock is distinct from expected_stock or p.variants is distinct from expected_variants then raise exception 'Stock changed while this form was open. Close it, refresh and try again'; end if;
  if jsonb_typeof(new_variants) is distinct from 'array' then raise exception 'Variants must be a list'; end if;
  if jsonb_array_length(new_variants)>0 then
    select coalesce(sum((value->>'stock')::bigint),0) into counted from jsonb_array_elements(new_variants);
    if counted<>new_stock then raise exception 'Variant quantities must add up to the product stock'; end if;
  end if;
  for v in select value from jsonb_array_elements(p.variants) loop
    if not exists(select 1 from jsonb_array_elements(new_variants) entry where entry->>'id'=v->>'id') and exists(
      select 1 from public.orders o cross join lateral jsonb_array_elements(o.items) item where o.workspace_id=p.workspace_id and item->>'productId'=p.id::text and item->>'variantId'=v->>'id'
    ) then raise exception 'A variant used in orders cannot be removed. Keep it with zero stock instead'; end if;
  end loop;
  perform set_config('app.variant_operation','on',true);
  if new_stock is distinct from p.stock or (product_values->>'cost')::numeric is distinct from p.cost then
    perform public.correct_product_inventory(p.id,new_stock,(product_values->>'cost')::numeric,product_values->>'correctionNote');
  end if;
  update public.products set name=trim(product_values->>'name'), price=(product_values->>'price')::numeric, low_stock_at=(product_values->>'lowStockAt')::integer,
    variant_name=coalesce(nullif(trim(product_values->>'variantName'),''),'Color'), variants=new_variants where id=p.id;
end $$;
revoke all on function public.save_product_variant_details(uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function public.save_product_variant_details(uuid,integer,jsonb,jsonb) to authenticated;

create function public.restock_product_variant(target_product_id uuid, target_variant_id text, added_quantity integer, new_unit_cost numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; v jsonb; updated jsonb:='[]'::jsonb; matched boolean:=false; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if added_quantity is null or added_quantity<=0 or new_unit_cost is null or new_unit_cost<0 then raise exception 'Enter a positive quantity and a nonnegative buying cost'; end if;
  select product.* into p from public.products product join public.workspace_members m on m.workspace_id=product.workspace_id and m.user_id=auth.uid() where product.id=target_product_id for update of product;
  if not found then raise exception 'Product not found in your workspace'; end if;
  for v in select value from jsonb_array_elements(p.variants) loop
    if v->>'id'=target_variant_id then matched:=true; v:=jsonb_set(v,'{stock}',to_jsonb((v->>'stock')::integer+added_quantity)); end if;
    updated:=updated||jsonb_build_array(v);
  end loop;
  if not matched then raise exception 'Choose a valid variant to restock'; end if;
  perform set_config('app.variant_operation','on',true);
  update public.products set variants=updated where id=p.id;
  result:=public.restock_product(p.id,added_quantity,new_unit_cost);
  return result;
end $$;
revoke all on function public.restock_product_variant(uuid,text,integer,numeric) from public,anon;
grant execute on function public.restock_product_variant(uuid,text,integer,numeric) to authenticated;