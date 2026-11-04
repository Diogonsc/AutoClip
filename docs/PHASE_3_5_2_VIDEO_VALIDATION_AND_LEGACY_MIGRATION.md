# Fase 3.5.2 — validação de vídeo e migração legada

**Escopo:** execução exclusivamente local em 2026-11-01. **Classificação: APROVADA LOCALMENTE.** Nenhum deploy, acesso remoto, OAuth TikTok, publicação ou cobrança foi realizado. A aprovação local não libera produção: permanece necessária uma decisão/provisão de runtime persistente para o worker Docker.

## Arquitetura

Imagens continuam no caminho existente de `media-validate`/WASM. Vídeos MP4 vão para `media-quarantine` e ficam em `VALIDATING`. A Edge Function apenas autoriza a solicitação; ela não tenta executar FFmpeg. O worker Node local reclama mídia por RPC service-only com lock/lease e `SKIP LOCKED`, baixa o objeto privado, valida em container Docker isolado, calcula SHA-256 dos bytes e promove com `upsert=false`. A RPC final compara lease, workspace, tamanho, hash e estado antes de marcar `READY/VALIDATED`. O objeto de quarentena é removido somente depois da confirmação SQL. Erros transitórios liberam a lease com retentativa; arquivos inválidos ficam `FAILED/REJECTED` e não recebem objeto final.

O container de validação usa FFprobe mais decodificação integral FFmpeg. O worker o inicia sem rede, como UID/GID do processo chamador, read-only, sem capabilities, com `512 MiB`, 1 CPU, 32 PIDs, filesystem temporário `noexec/nosuid`, timeout e argumentos estruturados (sem shell). O limite de arquivo é 50 MiB; mídia de vídeo tem até 600 s, 4096 px por lado, 16 MP por frame e 1–60 fps. MP4/H.264 é suportado; AAC é permitido como stream de áudio opcional. MOV e WebM são rejeitados explicitamente. Não há transcodificação.

## Integridade e compatibilidade

São registrados MIME detectado, tamanho, SHA-256, codec, dimensões, duração, data/versão do validador. O hash dos bytes temporários é comparado antes da promoção e o worker de publicação verifica o atestado persistido e conteúdo final. Agendamento individual, lote/CSV e worker falham fechados para mídia sem validação. Um job dependente fica `BLOCKED_PERMISSION` com motivo `MEDIA_VALIDATION_REQUIRED`, mantendo a reserva. O usuário pode pedir retomada explícita apenas depois da validação; a RPC revalida workspace, canal, reserva e data futura e reusa a reserva existente.

## Mídias legadas

`scripts/inventory_legacy_media.sql` é uma consulta read-only que agrupa por workspace, MIME, estado e validação, com referências/jobs/quota e sinalização de objetos ausentes, mídia compartilhada e risco. `npm --prefix apps/web run media:legacy:inventory` chama esse relatório apenas contra localhost. `scripts/revalidate_legacy_media.mjs` usa dry-run por padrão. Aplicação é somente local e requer `--apply-local --workspace UUID`; o worker valida os bytes do objeto existente e atualiza a mesma linha/ID, sem copiar ou remover o objeto, modificar job/lote ou alterar quota. Falhas permanecem bloqueadas. `npm --prefix apps/web run test:local:legacy-revalidation` comprova dry-run sem mudança, revalidação real de MP4 e PNG, IDs e relações preservados e retomada explícita sem nova reserva.

## Segurança e execução local

Migration incremental: `20261103000005_video_validation_and_legacy_revalidation.sql`. Ela preserva registros existentes, adiciona estado/lease e RPCs service-only, bloqueia mídia não validada nos agendamentos e evita corrida entre limpeza e revalidação. A limpeza real continua sujeita às configurações de retenção já existentes; nenhuma exclusão real de produção ocorreu. URLs de upload em quarentena podem continuar válidas até seu vencimento; elas não apontam para o bucket final.

```bash
docker build -t autoclip-video-validator:local -f scripts/video-validator/Dockerfile scripts/video-validator
node scripts/media-video-worker.mjs # somente Supabase local; valida host fail-closed
npm --prefix apps/web run test:local:legacy-revalidation
npm --prefix apps/web run test:e2e
```

O runner E2E cria contas/workspaces/arquivos próprios, valida localhost, bloqueia concorrência via lock exclusivo e limpa somente IDs/keys da execução. Os testes geram fixtures binárias com FFmpeg e não fazem chamadas de publicação TikTok.

## Evidências desta fase

- `docker build` do validador local: passou.
- FFmpeg/FFprobe reais: MP4 de fixture H.264 validado; JPEG/PNG/WebP decodificados. Casos E2E negativos incluem bytes falsos/truncados, contêiner inválido, codec MPEG-4, duração acima do limite e largura acima do limite.
- Supabase local `db reset` e pgTAP: 11 arquivos; 153 testes passaram antes da última inclusão de assertions de lease; a regressão final deve atualizar o total.
- Typecheck passou; Vitest 45/45; build de produção passou; worker 28/28.
- Concorrência PostgreSQL: reserva/idempotência, reagendamento obsoleto, cleanup `SKIP LOCKED`, claim exclusivo de validador e retomada após expiração passaram.
- Revalidação local: passou; dry-run intacto e MP4/PNG migrados mantendo ID, job/lote e reserva.
- E2E final: 20/20 passaram, 0 falhas e 0 skips, divididos em 10 cenários por projeto Chromium desktop 1440×900 e mobile 390×844. Incluiu autenticação, isolamento, upload real, validação binária, confirmação de lote de vídeo, repetição, reagendamento, cancelamento e CSV válido.
- Backup/restore PostgreSQL local: passou; dump custom de 559.328 bytes, restore isolado em 921 ms, zero FKs órfãs e todas as contagens/consulta RPC esperadas. O dump ficou em `/tmp` e não foi versionado.
- `npm audit --omit=dev`: 0 vulnerabilidades reportadas.
- Regressão final da migration: `supabase db reset` local aplicou 25 migrations; pgTAP passou em 11 arquivos/156 testes. Concorrência passou após atualizar a fixture de lease para executar como `service_role`.
- Inventário pós-teardown: executado em dry-run local após E2E, backup e revalidação; retornou zero linhas de mídia e confirmou que não houve alterações.
- `git diff --check`: executar novamente ao encerrar as alterações documentais.

Durante a execução foram corrigidos e reexecutados: JSX/E2E de direitos de áudio; isolamento do CSV mobile para evitar duplicação de conta/mídia/horário entre projetos; erro de feedback do CSV após a RPC confirmar; race de chamada da Edge Function versus rejeição do worker; limpeza de fixtures para excluir jobs antes da mídia; RPC/test fixture de cleanup para simular role do worker; fixture de backup com atestado H.264. Os primeiros resultados E2E tiveram falhas transitórias e uma execução de 20/20 que revelou avisos de teardown; após corrigir asserts, escopo e ordem de cleanup, a execução final passou sem avisos. O primeiro ensaio de backup falhou por fixture sem codec H.264 e passou após sua correção. Uma execução inicial de pgTAP falhou porque o teste de cleanup não simulava o role de serviço; o teste foi atualizado e a suíte completa passou. As execuções falhas iniciais não são contabilizadas como aprovação.

## Limitações e rollout

O worker depende de Docker para executar o decodificador. Supabase Edge Functions não são o runtime do FFmpeg. O stack atual Vercel + Supabase não fornece, por si só, um worker Docker persistente. Portanto MP4 só deve ser habilitado num ambiente que execute e monitore esse worker com os limites acima; produção permanece bloqueada até escolher/provisionar runtime, autenticação de serviço, rede/egress, limites de escala, alertas e operação. MOV/WebM permanecem indisponíveis. Também não foi feita homologação contra OAuth TikTok ou Content Posting API real.

Antes da migration remota: inventário read-only, backup PostgreSQL e Storage independente, restauração ensaiada, avaliação de jobs/reservas, pausa controlada do worker, migration revisada, revalidação por workspace em lotes, reconciliação manual e smoke de agendamento sem publicação. O rollback não pode apagar atestados nem liberar jobs: interromper claims, manter jobs bloqueados, restaurar banco/objetos de forma coordenada ou corrigir forward. Dump PostgreSQL não contém objetos Storage.
