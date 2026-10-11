-- Keep products and their historical references intact when archived.
alter table public.products add column archived boolean not null default false;
