-- Inventário administrativo somente leitura; resumo sem nomes, tokens ou captions.
begin transaction read only;
with refs as (
  select distinct m.id as media_id,j.id as job_id,j.status,j.scheduled_at
  from public.media_assets m
  left join public.publication_jobs j on j.workspace_id=m.workspace_id
    and (j.media_asset_id=m.id or m.id=any(coalesce(j.media_asset_ids,'{}'::uuid[])))
), per_media as (
  select m.id,m.workspace_id,m.mime_type,m.status::text as media_status,m.validation_status,
    m.detected_mime_type,
    not exists(select 1 from storage.objects o where o.bucket_id='media' and o.name=m.storage_key) as object_missing,
    count(distinct r.job_id) as job_references,
    count(distinct r.job_id) filter(where exists(
      select 1 from public.publication_quota_reservations q where q.publication_job_id=r.job_id and q.status='RESERVED')) as jobs_with_reserved_quota,
    count(distinct r.job_id) filter(where exists(
      select 1 from public.publication_quota_reservations q where q.publication_job_id=r.job_id and q.status='CONSUMED')) as jobs_with_consumed_quota,
    count(distinct r.job_id) filter(where r.status in ('SCHEDULED','READY','RETRY_WAIT') and r.scheduled_at>now()) as future_jobs,
    count(distinct r.job_id) filter(where r.status='RETRY_WAIT') as retry_jobs,
    count(distinct r.job_id) filter(where r.status='PROCESSING') as processing_jobs,
    count(distinct r.job_id) filter(where r.status='UNKNOWN') as unknown_jobs,
    count(distinct r.job_id) filter(where r.status='SENT_TO_INBOX') as inbox_jobs,
    count(distinct r.job_id) filter(where r.status='PUBLISHED') as published_jobs,
    count(distinct r.job_id) filter(where r.status='CANCELLED') as cancelled_jobs,
    count(distinct r.job_id)>1 as is_shared,
    bool_or(r.status in ('SCHEDULED','READY','RETRY_WAIT','PROCESSING','UNKNOWN')) as has_operational_jobs
  from public.media_assets m
  left join refs r on r.media_id=m.id
  group by m.id,m.workspace_id,m.mime_type,m.status,m.validation_status,m.detected_mime_type,m.storage_key
)
select jsonb_build_object(
  'workspace_id',workspace_id,
  'mime_type',mime_type,
  'media_status',media_status,
  'validation_status',validation_status,
  'media_count',count(*),
  'unverified_count',count(*) filter(where validation_status='UNVERIFIED'),
  'rejected_count',count(*) filter(where validation_status='REJECTED'),
  'missing_object_count',count(*) filter(where object_missing),
  'mime_mismatch_count',count(*) filter(where detected_mime_type is not null and detected_mime_type<>mime_type),
  'shared_media_count',count(*) filter(where is_shared),
  'job_references',sum(job_references),
  'jobs_with_reserved_quota',sum(jobs_with_reserved_quota),
  'jobs_with_consumed_quota',sum(jobs_with_consumed_quota),
  'future_jobs',sum(future_jobs),
  'retry_jobs',sum(retry_jobs),
  'processing_jobs',sum(processing_jobs),
  'unknown_jobs',sum(unknown_jobs),
  'inbox_jobs',sum(inbox_jobs),
  'published_jobs',sum(published_jobs),
  'cancelled_jobs',sum(cancelled_jobs),
  'risk',case
    when validation_status='UNVERIFIED' and bool_or(object_missing) then 'LEGACY_UNVERIFIED_OBJECT_MISSING'
    when validation_status='UNVERIFIED' and bool_or(has_operational_jobs) then 'LEGACY_UNVERIFIED_HAS_OPERATIONAL_JOBS'
    when validation_status='UNVERIFIED' then 'LEGACY_REVALIDATION_REQUIRED'
    when validation_status='REJECTED' then 'VALIDATION_REJECTED'
    else 'NO_LEGACY_VALIDATION_RISK' end
) as inventory
from per_media
group by workspace_id,mime_type,media_status,validation_status
order by workspace_id,mime_type,media_status,validation_status;
commit;
