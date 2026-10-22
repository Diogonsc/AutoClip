# tiktok-saas

SaaS multi-tenant de gestão e agendamento de vídeos TikTok (spec v1.1).

## Stack (adaptada da spec)

| Spec original | Implementação |
|---|---|
| Backend Node/REST local | Supabase (PostgREST + RLS + Edge Functions) |
| Worker Node no Ubuntu | `pg_cron` + Edge Function; fila em `publication_jobs` |
| Vídeos em disco local | Supabase Storage, bucket privado `media` (50 MB/arquivo no Free) |
| Front React/Vite local | React/Vite publicado na Vercel |

## Etapa 1: banco, RLS e Auth

```
supabase/
├── config.toml
├── migrations/
│   ├── 20261020000001_schema.sql            # 12 tabelas, enums, triggers, bootstrap de workspace
│   ├── 20261020000002_rls.sql               # helpers de papel, grants por coluna, políticas RLS
│   ├── 20261020000003_storage_and_queue.sql # bucket, policies de Storage, fila, recuperação
│   ├── 20261020000004_frontend_support.sql  # finalize_media, convite de membros, auditoria
│   ├── 20261021000001_enum_sent_to_inbox.sql
│   └── 20261021000002_tiktok_integration.sql # modos INBOX/DIRECT, OAuth state, lease, fila, cron do worker
└── tests/database/                          # pgTAP: 01 isolamento, 02 integração TikTok
```

### Decisões de segurança

- **Cadastro** cria automaticamente `profile` + workspace pessoal (OWNER) + `workspace_settings`.
- **FKs compostas** `(channel_id, workspace_id)` e `(media_asset_id, workspace_id)`: o banco impede
  que uma publicação misture canal/mídia de outro workspace.
- **Grants por coluna**: o usuário não consegue alterar `connection_status`, `status` de mídia, nem
  mover jobs para `PROCESSING`/`PUBLISHED`. Isso só o backend (service_role) faz.
- **`oauth_connections`**: nenhum grant para `anon`/`authenticated`; só Edge Functions leem.
- **Publicação automática** desligada por padrão (`auto_publish_enabled`), só OWNER liga.
- **Job preso em `PROCESSING`** vira `UNKNOWN` (nunca reenvia sozinho → sem publicação duplicada).

### Rodando localmente

```bash
supabase start
supabase db reset     # aplica as migrations
supabase test db      # roda os testes pgTAP
```

### Subindo para o projeto na nuvem

```bash
supabase link --project-ref <ref>
supabase db push
```

## Etapa 2: frontend (`apps/web`)

React + TypeScript + Vite, falando direto com o Supabase (anon key + RLS). Telas: login/cadastro/recuperação de senha,
painel, canais, biblioteca de vídeos (upload com `finalize_media`), publicações (rascunho/agendamento com fuso),
calendário (mês/semana/dia), histórico com tentativas e eventos, notificações, membros, configurações e auditoria.

```bash
cd apps/web
cp .env.example .env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5173
npm test                     # testes de fuso horário
npm run build
```

Deploy na Vercel: Root Directory = `apps/web`, variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
(somente a chave pública). No Supabase, em Auth → URL Configuration, inclua a URL da Vercel em Site URL e Redirect URLs
(inclusive `/reset-password`). A migration `20261020000004_frontend_support.sql` precisa estar aplicada.

## Etapa 3: Edge Functions (OAuth TikTok, worker, pg_cron)

```
supabase/functions/
├── _shared/                     # lógica pura (testável em Node) + wiring Deno em runtime.ts
├── publication-worker/          # disparado a cada minuto pelo pg_cron (header x-worker-secret)
├── tiktok-channel/              # front: connect | creator_info | disconnect (JWT do usuário)
├── tiktok-oauth-callback/       # redirect_uri do TikTok (state de uso único)
└── _tests/                      # 72 testes (node --test)
```

**Modos de publicação** (`workspace_settings.publish_mode`, só OWNER altera):
`INBOX` (escopo `video.upload`; o vídeo vai para o rascunho do app TikTok, status `SENT_TO_INBOX`) e
`DIRECT` (escopo `video.publish`; exige `privacy_level` vindo de `creator_info`).
Apps TikTok **não auditados** só publicam como `SELF_ONLY`; o job fica `BLOCKED_APPROVAL` até a auditoria.

**Garantias do worker**: um worker por vez (`worker_leases`); o `publish_id` é gravado *antes* do upload;
resultado ambíguo (rede/resposta malformada) vira `UNKNOWN` e nunca reenvia sozinho; só há nova tentativa
depois que o TikTok confirma `FAILED`. Jobs `UNKNOWN` são resolvidos manualmente (`resolve_unknown_job`).
Tokens ficam cifrados (AES-256-GCM, AAD = id do canal) em `oauth_connections`.

### Configuração

1. No app em developers.tiktok.com: produtos *Login Kit* e *Content Posting API*; Redirect URI =
   `https://<ref>.supabase.co/functions/v1/tiktok-oauth-callback`.
2. Segredos das funções (veja `supabase/functions/.env.example`):
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # preencha
   supabase secrets set --env-file supabase/functions/.env
   ```
3. Deploy:
   ```bash
   supabase db push
   supabase functions deploy publication-worker tiktok-channel tiktok-oauth-callback
   ```
4. Vault, para o pg_cron achar a função (SQL Editor; `worker_secret` = `WORKER_SECRET` acima):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<mesmo valor de WORKER_SECRET>', 'worker_secret');
   ```
   Sem esses dois segredos o cron simplesmente não dispara nada.
5. Em Auth → URL Configuration e em `WEB_URL`, a URL da Vercel (a primeira origem recebe `/canais?tiktok=<resultado>`).

### Testes

```bash
cd supabase/functions && node --test _tests/*.test.ts     # Node >= 22.6 (type stripping)
supabase test db                                          # pgTAP (isolamento + integração)
```

Limites da validação feita até aqui: o código Deno (`index.ts`, `runtime.ts`, `supabase-db.ts`, `channel-db.ts`)
e o frontend **não foram executados** (sem Deno/CLI/npm no ambiente de desenvolvimento); a API real do TikTok
também não foi chamada. Faça um teste ponta a ponta com um canal sandbox antes de usar em produção.

## Próximas etapas

1. Teste ponta a ponta com um app/canal sandbox do TikTok (OAuth, INBOX, DIRECT) e `npm install && npm run build` no front.
2. Auditoria do app no TikTok (publicação pública em modo DIRECT).
