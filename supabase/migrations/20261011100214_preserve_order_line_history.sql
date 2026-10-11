-- Preserve variant snapshots and older unrecorded lines after removing another order item.
create or replace function private.prepare_order_variants(order_items jsonb, target_workspace uuid, previous_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry record; p public.products%rowtype; v jsonb; item jsonb; old_item jsonb; result jsonb:='[]'::jsonb;
begin
  for entry in select value,ordinality from jsonb_array_elements(order_items) with ordinality loop
    item:=entry.value; old_item:=previous_items->((entry.ordinality-1)::integer);
    -- Removing an earlier line changes its ordinal position, not its identity.
    if old_item->>'productId' is distinct from item->>'productId'
       or nullif(old_item->>'variantId','') is distinct from nullif(item->>'variantId','') then
      select candidate.value into old_item
      from jsonb_array_elements(coalesce(previous_items,'[]'::jsonb)) with ordinality candidate(value,position)
      where candidate.value->>'productId'=item->>'productId'
        and nullif(candidate.value->>'variantId','') is not distinct from nullif(item->>'variantId','')
      order by (candidate.value->>'variantLabel' is not distinct from item->>'variantLabel') desc, candidate.position
      limit 1;
    end if;
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
