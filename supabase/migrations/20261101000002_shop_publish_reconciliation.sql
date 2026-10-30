-- A publicação no TikTok Shop é uma operação externa não transacional.
-- O marcador é gravado antes da chamada final à API para impedir uma nova
-- publicação caso a API tenha aceitado o vídeo, mas o ID remoto não tenha
-- sido persistido localmente.

alter table public.publication_jobs
  add column if not exists shop_publish_started_at timestamptz;

create index if not exists publication_jobs_shop_reconciliation_idx
  on public.publication_jobs (shop_publish_started_at)
  where shop_publish_started_at is not null and shop_video_id is null;
