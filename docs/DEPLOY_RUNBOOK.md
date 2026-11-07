# AutoClipe — runbook para implantação futura

**Estado atual:** somente preparação. Nenhum deploy ou alteração remota foi executada na Fase 3.4. A homologação visual e TikTok real permanecem bloqueadas; não tratar este documento como autorização de lançamento.

## 1. Pré-condições e backup

Antes de qualquer release aprovado:

1. Definir janela de implantação, responsável e canal de incidentes.
2. Registrar o commit/artefato que será publicado; o worktree atual ainda contém alterações locais e não representa um artefato release.
3. Conferir o ledger remoto de migrations e comparar com o histórico versionado; não presumir que as migrations `20261103000001`–`20261103000003` foram aplicadas.
4. Fazer backup consistente do banco pelo mecanismo disponível no plano contratado e de objetos do Storage conforme ferramenta/plano; verificar que a cópia existe e sua data.
5. Fazer ensaio de restauração em projeto isolado. Backup sem restauração ensaiada não é critério de rollback.
6. Anotar contagens de jobs por estado e fila antes da mudança; investigar `PROCESSING`, `UNKNOWN` e itens aguardando ação sem editar estados manualmente.
7. Confirmar que exclusão automática real está desabilitada e `dry-run` permanece habilitado.

## 2. Compatibilidade e migrations

Aplicar apenas depois de revisar o histórico remoto e plano de locks. Ordem local:

1. `20261103000001_account_groups_and_publication_batches.sql` — tabelas e relações de grupo/lote, FK composta e RPC de confirmação.
2. `20261103000002_batch_management_and_carousels.sql` — operações de lote, paginação, agregados, índices e validações. A versão local inclui lock de idempotência.
3. `20261103000003_allow_image_media_uploads.sql` — atualiza a allowlist do bucket `media` para formatos já aceitos pelo frontend.
4. `20261103000004_secure_media_validation_pipeline.sql` — altera grants/policies, cria quarentena e exige atestado server-side; inclui backfill para `UNVERIFIED`. Exige rollout coordenado com inventário de mídias e jobs legados.
5. `20261103000005_video_validation_and_legacy_revalidation.sql` — adiciona estado/lease e RPCs service-only de validação e revalidação legada. Worker local Compose/FFmpeg foi homologado apenas contra Supabase **local**. Antes de Cloud, aprovar runtime, credenciais, rede, recursos, retries/monitoramento e procedimento de revalidação de legado; Vercel + Supabase não fornecem worker Docker persistente. MP4/H.264 é aceito; MOV/WebM são recusados.
6. `20261103000006_video_worker_heartbeat.sql` — adiciona heartbeat global service-only com RLS sem policy cliente. Comparar migration history Cloud antes de qualquer aplicação; nunca executar `db push` sem autorização explícita.

Essas migrations são incrementais no banco limpo local. A execução local não prova compatibilidade com estado ou dados do banco remoto. `CREATE INDEX` ocorre sem `CONCURRENTLY`; para banco remoto grande, estimar bloqueio e janela antes de aplicar. A FK composta deve ser conferida contra dados órfãos previamente. Não há migrations automáticas de rollback: preferir uma migration forward fix quando já houver tráfego.

## 3. Variáveis e pré-requisitos externos

Conferir nomes e escopo de ambiente sem imprimir valores:

- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Edge Functions/Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SECRET`, `TOKEN_ENCRYPTION_KEY`.
- TikTok: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`; confirmar aprovação, scopes autorizados e callback cadastrado.
- Fotos/carrosséis: `TIKTOK_VERIFIED_MEDIA_HOST`; domínio HTTPS precisa corresponder ao domínio de mídia verificado no TikTok.
- `WEB_URL`, quando configurado, precisa apontar para a origem frontend correta.

Não inserir credenciais em `VITE_*` exceto a URL pública e anon key. Service role, segredos OAuth, segredo de worker e chave de criptografia só no cofre/server env. Fazer rotação planejada, nunca imprimir valores em CI/logs.

Não exigir domínio próprio no desenvolvimento. Para fotos via `PULL_FROM_URL`, o domínio HTTPS verificado é dependência externa da API.

## 4. Ordem segura de implantação

1. Validar backup PostgreSQL e recuperação independente de Storage; restore de ensaio obrigatório.
2. Comparar ledger remoto, inventariar mídia/jobs/reservas em read-only e revisar bloqueios legados.
3. Aplicar migrations aprovadas em homologação e executar smoke SQL/pgTAP/RLS.
4. Publicar Edge Functions compatíveis; manter `media-cleanup` em dry-run e exclusão real desligada.
5. Provisionar worker aprovado; revisar segredo de alta permissão, boot, HTTPS de saída, egress/recursos, heartbeat, leases e alerta. Não conectar o PC de desenvolvimento a Cloud até aprovação específica.
6. Publicar frontend e validar login, workspace, dashboard, upload e agendamento sem publicar.
7. Fazer piloto de mídia autorizado, verificar hash no Storage, fila e histórico; reconciliar jobs legados manualmente sem duplicar reservas.
8. Smoke TikTok somente com conta/app aprovado e autorização expressa. Não publicar vídeo real nesta fase.
9. Cobrança permanece fora deste runbook até fase final e autorização específica.

Para operação comercial, não usar Vercel Hobby. Confirmar plano/termos atuais da Vercel e Supabase, quotas de Storage/egress/Edge Functions, backup/PITR e limites de cron antes de vender acesso.

## 5. Smoke tests e critérios de interrupção

Interromper a liberação se ocorrer qualquer um destes sinais:

- Migration falha ou exige reconstrução de dados não planejada.
- Usuário de teste consegue ler/escrever outro workspace ou mídia privada.
- Reserva/consumo de quota diverge de jobs, ou confirmação repetida cria mais de um job.
- Worker inicia publicação em estado/conta inválidos ou repete publicação de resultado desconhecido.
- Falhas persistentes em uploads de vídeo/imagem permitidos, callbacks OAuth ou chamadas de RPC.
- A limpeza sair de dry-run ou tentar claim de arquivo referenciado.
- Crescimento inesperado de `UNKNOWN`, jobs presos ou erro não-2xx.

Não repetir job ambíguo para “destravar”. Fazer reconciliação pelo `remote_publish_id` e estado oficial. Não executar limpeza física nesta fase.

## 6. Rollback

- **Frontend:** reverter para o deployment Vercel anterior, mantendo a API de banco compatível com versão antiga. Não há deploy nesta fase.
- **Edge Functions:** republicar a versão anterior identificada e compatível com schema. Manter segredo sincronizado entre invocador e função.
- **Banco:** não apagar tabelas/colunas nem executar down migration automaticamente. Se houver corrupção, congelar operações, preservar logs/backup e decidir entre correção forward e restore com responsável de dados.
- **Jobs:** antes de reativar worker, comparar contagens e reconciliar jobs `PROCESSING`/`UNKNOWN`; não reinserir lote já confirmado nem reusar chave de idempotência para conteúdo novo.
- **Storage:** manter objetos intactos. O objeto e metadado são recursos separados; restore deve considerar ambos.

Registrar horários, artefatos, erros e decisões do incidente. Validar restauração num ambiente separado antes de restaurar dados de produção.

## 7. Estado atual

Reset local e testes passam conforme `docs/PHASE_3_4_HOMOLOGATION.md`. A interface autenticada não foi visualmente homologada, o OAuth oficial continua dependendo de aprovação/configuração TikTok, e a reconciliação do ledger remoto não foi feita. A implantação está **bloqueada até homologação manual, artefato versionado, conferência de migrations remotas e aprovação operacional**.
# Complemento para Fase 3.5 — ensaio local de backup

Foi adicionado `npm --prefix apps/web run test:local:backup-restore`. O script só prossegue com endpoints localhost, cria fixtures temporárias, usa `pg_dump` custom do container Supabase PostgreSQL local, restaura em um banco local isolado e valida contagens/FKs/RPC antes de remover o banco destino e fixtures.

O ensaio observado restaurou 1 workspace, channel, group, media metadata, batch, job terminal, quota cycle e audit marker; zero FKs órfãs; RPC de lotes presente. Não executa qualquer backup ou restauração remota.

**Diferença operacional:** o ensaio exclui `pg_cron`, pois a configuração local fixa `cron.database_name=postgres`; a extensão precisa permanecer no banco operacional designado. O dump de PostgreSQL também não inclui binários do Storage nem secrets/configuração externa. A restauração de produção exige backup separado/estratégia de recuperação para objetos e configuração Supabase, e prova de restauração antes do deploy.

Checklist pré-deploy adicional: executar E2E autenticado local, validar arquivos/mime/limites, gerar dump consistente, restaurar em projeto isolado com extensão/cron da topologia alvo, comparar dados e testar signed URLs/Storage. Não usar o banco de desenvolvimento como destino de `pg_restore`.

## 8. Adendo Fase 3.6 — worker de vídeo local

Compose, sidecar FFmpeg, secrets de arquivo, health/heartbeat, restart e stop gracioso foram exercitados com Supabase local. Isso não valida Cloud nem prova inicialização após reboot. Nesta máquina Docker estava enabled; linger estava `no`; o unit não foi instalado. Para operação antes do login, administrador deve revisar e autorizar `sudo loginctl enable-linger <usuário>`; o instalador não chama sudo. Ubuntu 24 também precisa smoke em host dessa versão (execução desta fase foi Ubuntu 26.04.1).

O worker usa service role, ainda sem credencial de escopo restrito. Não conectar à Cloud até avaliar dispositivo, custody/rotação e alternativa de menor privilégio. Consulte `docs/PHASE_3_6_LOCAL_WORKER_AND_PILOT_READINESS.md`.

> **Correção de histórico (Fase 3.6.1):** o parágrafo acima descreve o estado da Fase 3.6 e foi supersedido. O worker residente atual usa HMAC específico para `video-worker-api`; a service role permanece somente no runtime confiável Edge, não no container local. Isso foi exercitado localmente e não comprova deploy/configuração Cloud. Ver `docs/PHASE_3_6_1_LOCAL_WORKER_SECURITY_AND_AUTOSTART.md`.

# Bloqueio adicional — pipeline de mídia (Fases 3.5.1/3.5.2)

As migrations de mídia permanecem locais. O inventário legado e dry-run foram testados localmente; revalidação local de MP4/PNG preservou IDs, jobs, lote e reserva. Antes de deploy: executar inventário somente leitura com autorização, backup/restauração de banco e objetos Storage separados, revisar cada job dependente, provisionar worker isolado, ensaiar migration e rollout em cópia, pausar claims conforme plano, revalidar em lotes e retomar jobs somente por ação autorizada. Rollback não pode simplesmente apagar o atestado ou reabrir a escrita do cliente; interromper worker/claims, preservar reservas e aplicar correção forward ou restore coordenado de DB e objetos.
# Addendum operacional — worker local 3.6.1

O daemon de vídeo usa systemd de usuário + Docker Compose, sem portas públicas, sem socket Docker e sem credencial `service_role` no container. A instalação executada localmente não usou sudo; Docker já estava enabled/active. A unit foi verificada e ficou enabled/active na sessão atual, mas `linger=no` e reboot não foi testado.

Para início pré-login, requer aprovação de administrador: `sudo loginctl enable-linger diogo-nascimento`. Em uma janela autorizada, depois de habilitar linger, reiniciar e verificar `systemctl --user is-active autoclip-video-worker-api autoclip-local-worker`, `scripts/local-worker/status.sh`, heartbeat recente e fila. Não considerar sintaxe da unit como teste de reboot. Suspensão do computador não foi alterada: se o host suspender, validação para e retoma quando voltar; não desativar bloqueio de tela.

Segredos do worker vivem em `deploy/local-worker/secrets/` (0600) e `.edge.env` (0600), localmente ignorados. Rotação: gerar novo `video_worker_api_secret`/`video_validation_attestation_key`, publicar simultaneamente no runtime autorizado Edge e arquivos locais, reiniciar API e Compose e validar heartbeat; se houver suspeita de exposição, parar claims e revogar a chave antiga antes de retomar. Nenhum segredo Cloud foi criado ou consultado nesta homologação. Consulte `PHASE_3_6_1_LOCAL_WORKER_SECURITY_AND_AUTOSTART.md`.

Rollout Cloud futuro continua bloqueado até aprovação separada, inventário remoto read-only, backup/restauração PostgreSQL e Storage, comparação de migration history, plano de revalidação de mídia legada e autorização de segredos. Não executar `db push` ou deploy com base apenas na aprovação local.
# Aditivo da Fase 3.6.2 — auditoria Cloud pendente

A auditoria Cloud desta fase não foi autorizada para conexão e nenhuma operação remota foi executada. Antes de planejar rollout, confirme explicitamente o project ref/ambiente, obtenha identidade PostgreSQL dedicada read-only e execute o preflight da ferramenta `scripts/cloud-audit/readonly-audit.mjs`. Não use service role, credencial de produção ampla ou token de Management API como se fosse read-only. Se o preflight detectar DML/DDL, BYPASSRLS, privilégio de criação ou associação administrativa, interrompa e solicite credencial/decisão.

O manifesto tem 29 migrations locais e o ledger do banco local bate com as 29; o ledger Cloud e configuração de Storage/Edge Functions/Auth permanecem não verificados. A implantação não deve ser autorizada até existir comparação remota revisada, backup/restauração comprovados, análise de mídia legada/jobs/quotas e plano de rollback específico. `pg_restore` não restaura bytes do Storage nem configuração/secrets.
