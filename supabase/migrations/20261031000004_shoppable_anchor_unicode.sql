alter table public.publication_jobs drop constraint if exists publication_jobs_shop_anchor_check;
alter table public.publication_jobs add constraint publication_jobs_shop_anchor_check check (
  (shop_product_id is null and shop_anchor_title is null)
  or (shop_product_id is not null and shop_anchor_title is not null and char_length(shop_anchor_title) between 1 and 30
      and shop_anchor_title !~ '[[:punct:]]')
);
