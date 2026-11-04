# Fase 3.5.1 — endurecimento do Storage e homologação E2E

**Execução:** ambiente local, 2026-11-01. **Classificação atual: parcialmente homologada.** Não houve acesso a Supabase remoto, TikTok, produção, deploy ou cobrança.

## Arquitetura e correção

Antes desta fase, um cliente autenticado podia gravar diretamente no bucket final e declarar `image/png` para bytes que não eram PNG. O limite e a allowlist do Storage validam metadados declarados, não fazem inspeção binária.

O fluxo novo é `begin_media_upload` (cria somente registro `UPLOADING/PENDING` e chaves determinísticas) → upload do objeto no bucket privado `media-quarantine` → Edge Function `media-validate` autentica o JWT, confere membership/role e autoria, baixa o objeto de quarentena e valida conteúdo → grava os mesmos bytes no bucket final com `upsert=false` → grava atestado via RPC exclusiva de `service_role`, tornando o registro `READY/VALIDATED` → remove o objeto de quarentena. As policies retiram INSERT/UPDATE do cliente no bucket final e a inserção direta de `media_assets`; o cliente não pode executar `finalize_media`, nem escrever campos do atestado. Uma falha não promove a mídia.

Imagens JPEG, PNG e WebP são verificadas no backend com decodificadores WASM `@jsquash`, além de MIME detectado, estrutura, dimensões, limites de 20 MiB, 4096 px por lado e 16 milhões de pixels. A função armazena SHA-256, tamanho e versão do validador. O worker rebaixa o risco de alteração posterior baixando o objeto e comparando tamanho/hash antes de qualquer chamada ao TikTok. O banco exige atestado para `READY` e as RPCs de agendamento exigem mídia READY/VALIDATED do mesmo workspace. Carrosséis verificam cada imagem.

### Limitação de vídeo e efeito sobre operação

O runtime Edge atual não contém decodificador completo de contêiner/streams/codecs para MP4, MOV e WebM. O validador falha fechado com `VIDEO_VALIDATOR_UNAVAILABLE`; a UI bloqueia envio de vídeos e o seletor aceita somente imagens até haver validador server-side seguro. Não foi validado conteúdo de vídeo, ainda que uma fixture MP4 válida tenha sido gerada localmente. Não há fallback por extensão ou MIME.

A migration marca arquivos anteriores à atestação como `UNVERIFIED`. Eles permanecem no banco/Storage, mas não podem ser agendados nem processados pelo worker até revalidação. Este é um **bloqueio para implantação** enquanto não houver plano controlado para validar/recarregar mídia pré-existente e tratar jobs já agendados. Não aplicar esta migration remotamente sem esse plano e sem avaliar jobs ativos.

## Buckets e permissões

- `media`: privado; cliente não faz upload nem update. Escritas finais são service role. Leitura segue membership/policies existentes.
- `media-quarantine`: privado, limite 50 MiB e allowlist explícita. Upload exige papel editável, asset `UPLOADING/PENDING`, autoria e caminho exato `<workspace>/<asset>/upload`.
- URL assinada emitida pelo cliente continua sujeita à policy de leitura e expiração solicitada; não há mecanismo alegado de revogação imediata. Objetos finais não podem ser sobrescritos por cliente.
- A Edge Function valida o usuário com Auth local e usa service role somente server-side. Os tokens não são enviados ao browser nos testes.

O bucket não inspeciona codecs nem assinaturas; isso é feito para imagens pela função. O teste cobre upload/validação real das imagens, bem como rejeição de conteúdo truncado/inválido. Limites do Storage continuam relevantes independentemente do validador.

## Concorrência de fixtures

`run-local-e2e.mjs` gera sufixo único para usuários, workspaces, grupos, contas e objetos, remove somente os IDs próprios e obtém lock exclusivo em `/tmp/autoclip-e2e-local.lock` antes de criar fixtures. O teste de concorrência executou dois runners: o primeiro concluiu o cenário de login (1 aprovado) e o segundo falhou fechado antes de criar fixtures. A estratégia é serialização/recusa, não execução simultânea de duas suítes independentes.

## Evidências e estado E2E

O Playwright já executou em Chromium desktop 1440×900 e mobile 390×844 com Auth Supabase local. Os cenários existentes incluem autenticação/login/logout, rotas protegidas, dashboard/listas, grupos e prévia sem reserva, upload real de PNG via navegador, validação binária e Storage, isolamento por workspace, confirmação de lote, repetição, reagendamento, cancelamento, CSV inválido e troca de workspace/sessão revogada. Nenhuma publicação é enviada ao TikTok.

Na execução de regressão desta fase, a primeira suíte E2E encontrou seletores ambíguos de `role=alert`, interferência entre workspaces compartilhados nos projetos desktop/mobile e uma corrida de feedback depois do cancelamento. Foram corrigidos os seletores, os projetos de lote passaram a usar workspaces distintos, e a interface agora só informa sucesso de cancelamento depois da resposta RPC. Após as correções, a suíte completa **passou: 20/20, 0 falhas, 0 skips**, com 10 cenários por projeto. Desktop e mobile percorreram confirmação, repetição, reagendamento e cancelamento do lote sem chamar TikTok.

**Não executado/suportado:** confirmação de lote válido de vídeo, importação/confirmacão CSV de vídeo válido, upload/aprovação de MP4/MOV/WebM e fluxo mobile de confirmação completa permanecem bloqueados pelo validador de vídeo ausente. Carrossel até confirmação não usa API real; não se envia conteúdo ao TikTok. Playwright local não substitui homologação OAuth externa.

## Testes desta continuação

| Verificação | Resultado comprovado até agora |
|---|---|
| Worker `bun test .../worker.test.ts` | 27 passaram, 0 falharam |
| Typecheck | passou; build executa novamente `tsc --noEmit` |
| Build | passou; Vite 8.3.5 produziu build de produção |
| Vitest | 45 passaram em 5 arquivos, 0 falharam |
| E2E desktop+mobile | 20 passaram, 0 falharam, 0 skips; 10 por resolução |
| `supabase db reset` | passou localmente; 24 migrations aplicadas, inclusive 000004 |
| pgTAP | passou: 10 arquivos, 138 testes |
| Concorrência | passou: quota, confirmação idempotente concorrente, reagendamento obsoleto e `SKIP LOCKED` |
| Backup/restore | passou; dump 532.047 bytes; restore isolado 929 ms; zero FKs órfãs |
| Worker | 27 passaram, 0 falharam |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas |
| `git diff --check` | passou antes da atualização final da documentação; executar novamente ao encerrar |

Fixtures SQL/backup com atestados sintéticos são dados privilegiados de teste, não equivalem a validação de binários de vídeo.

## Migrations e recuperação

Migration incremental local: `20261103000004_secure_media_validation_pipeline.sql`. Ela altera grants/policies, cria bucket de quarentena, RPCs e triggers, adiciona metadados de validação e troca os validadores de agendamento. Não foi aplicada remotamente. Rollback automático não é recomendado: reabrir escrita no bucket final desfaria a barreira de segurança; a restauração deve ser planejada com backup e migração corretiva revisada. O checklist operacional permanece em `docs/DEPLOY_RUNBOOK.md`.

## Pendências bloqueantes

1. Implementar e testar decodificação confiável de vídeo no runtime escolhido, ou manter vídeo explicitamente indisponível.
2. Definir revalidação/recarga segura para arquivos legados `UNVERIFIED` e tratamento de jobs agendados antes de aplicar migration fora do ambiente local.
3. Finalizar a execução Playwright corrigida em desktop/mobile e publicar seus totais reais.
4. Reexecutar a regressão final após a migration e as alterações atuais.
5. Homologação externa de OAuth, permissões TikTok e Content Posting API continua fora desta fase.

## Adendo Fase 3.5.2

Os bloqueios de validação local de vídeo e revalidação legada foram endereçados pela migration `20261103000005_video_validation_and_legacy_revalidation.sql`, pelo worker Docker local e pelos scripts de inventário/revalidação. O comportamento histórico acima representa corretamente o encerramento da Fase 3.5.1; consultar `docs/PHASE_3_5_2_VIDEO_VALIDATION_AND_LEGACY_MIGRATION.md` para arquitetura e resultados novos. A infraestrutura de execução persistente do worker permanece pendente para qualquer ambiente fora do local.
