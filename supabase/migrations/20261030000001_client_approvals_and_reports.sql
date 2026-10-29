-- Aprovação de publicações por link público de uso único e métricas derivadas do histórico.
alter table public.publication_jobs
  add column if not exists approval_required boolean not null default false,
  add column if not exists approval_status text not null default 'NOT_REQUIRED'
    check (approval_status in ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

create table if not exists public.publication_approval_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  publication_job_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  decision text not null default 'PENDING' check (decision in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  reviewer_name text,
  reviewer_note text,
  decided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (publication_job_id, workspace_id)
    references public.publication_jobs(id, workspace_id) on delete cascade
);
create index if not exists publication_approval_links_job_idx
  on public.publication_approval_links(publication_job_id, created_at desc);
alter table public.publication_approval_links enable row level security;
revoke all on public.publication_approval_links from anon, authenticated;

-- Public access is exclusively mediated by the Edge Function, which stores only token hashes.
create or replace function private.guard_approval_required()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('SCHEDULED','READY','PROCESSING','RETRY_WAIT')
     and new.approval_required and new.approval_status <> 'APPROVED' then
    raise exception 'client_approval_required: esta publicação precisa ser aprovada pelo cliente antes de ser enviada.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_approval_required on public.publication_jobs;
create trigger guard_approval_required
before insert or update of status, approval_required, approval_status
on public.publication_jobs for each row execute function private.guard_approval_required();

-- Ações de relatório não exigem novas tabelas: as métricas são agregadas a partir do histórico real.
