-- Uma publicação pode usar a API Shoppable Video quando tiver um produto afiliado.
alter table public.publication_jobs
  add column if not exists shop_product_id uuid references public.tiktok_shop_products(id) on delete restrict,
  add column if not exists shop_anchor_title text,
  add column if not exists shop_is_ai_generated boolean not null default false,
  add column if not exists shop_video_id text;

alter table public.publication_jobs
  add constraint publication_jobs_shop_anchor_check check (
    (shop_product_id is null and shop_anchor_title is null)
    or (shop_product_id is not null and shop_anchor_title is not null and char_length(shop_anchor_title) between 1 and 30
        and shop_anchor_title !~ '[[:punct:]]')
  );

create or replace function public.validate_shoppable_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.shop_product_id is not null then
    if new.post_type <> 'VIDEO' then raise exception 'shoppable publication requires a video'; end if;
    if not exists (select 1 from public.tiktok_shop_products p join public.tiktok_shop_connections c on c.id = p.connection_id
      where p.id = new.shop_product_id and p.workspace_id = new.workspace_id and c.channel_id = new.channel_id
        and c.connection_status = 'CONNECTED') then
      raise exception 'shop product must belong to a connected shop account for this channel';
    end if;
  end if;
  return new;
end; $$;
create trigger publication_shoppable_guard before insert or update of shop_product_id, shop_anchor_title, channel_id, workspace_id, post_type
on public.publication_jobs for each row execute function public.validate_shoppable_publication();

grant insert (shop_product_id, shop_anchor_title, shop_is_ai_generated) on public.publication_jobs to authenticated;
grant update (shop_product_id, shop_anchor_title, shop_is_ai_generated) on public.publication_jobs to authenticated;
