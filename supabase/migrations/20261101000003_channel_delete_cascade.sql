-- Excluir um canal também remove as publicações que dependem dele. As tabelas
-- dependentes de publication_jobs (tentativas, eventos, aprovações e vínculos
-- de produtos) já usam ON DELETE CASCADE.
alter table public.publication_jobs
  drop constraint if exists publication_jobs_channel_id_workspace_id_fkey;

alter table public.publication_jobs
  add constraint publication_jobs_channel_id_workspace_id_fkey
  foreign key (channel_id, workspace_id)
  references public.channels (id, workspace_id)
  on delete cascade;
