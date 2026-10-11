begin;
do $$ declare u uuid; begin
 select user_id into u from public.workspace_members limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$ declare w uuid; p uuid; o uuid; original jsonb; begin
 select private.current_workspace_id() into w;
 insert into public.products(workspace_id,name,cost,price,stock) values(w,'__archive_transaction_test__',40,100,5) returning id into p;
 insert into public.orders(workspace_id,client_name,phone,address,status,items) values(w,'__archive_transaction_test__','','','Delivered',jsonb_build_array(jsonb_build_object('productId',p,'quantity',1,'unitPrice',100))) returning id into o;
 select items into original from public.orders where id=o;
 update public.products set archived=true where id=p and workspace_id=w;
 if not (select archived from public.products where id=p) then raise exception 'Archive did not persist'; end if;
 if (select stock from public.products where id=p)<>4 then raise exception 'Archive changed stock'; end if;
 if (select items from public.orders where id=o) is distinct from original then raise exception 'Archive changed order history'; end if;
 if not exists(select 1 from public.orders ord join public.products prod on prod.id=(ord.items->0->>'productId')::uuid where ord.id=o and prod.name='__archive_transaction_test__') then raise exception 'Historical product identity lost'; end if;
 update public.products set archived=false where id=p and workspace_id=w;
 if (select archived from public.products where id=p) then raise exception 'Restore did not persist'; end if;
end $$;
rollback;
