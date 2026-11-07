# AutoClipe — Fase 3.4: homologação local

**Data:** 2026-11-01
**Escopo:** validação e estabilização local; sem deploy, commit, push, banco remoto, OAuth TikTok real, publicação real ou remoção física de mídia.

## Resumo executivo

**Parcialmente homologada.** TypeScript, Vitest, build, worker, migrações locais, pgTAP e concorrência foram verificados. A auditoria encontrou e corrigiu três problemas locais: confirmação concorrente com a mesma chave de idempotência, custo desnecessário ao agregar lotes fora da página atual e allowlist do bucket que bloqueava imagens já aceitas pela biblioteca. A FK composta do lote também poderia tentar zerar `workspace_id` (NOT NULL) ao remover um lote; agora somente `batch_id` é zerado.

Não foi possível executar homologação visual autenticada: não há Playwright/Cypress nem sessão de usuário de teste, e a superfície de navegador disponível nesta execução retornou `apps: []` e `browsers: []`. Não foi simulada aprovação visual.

## Evidências executadas

| Verificação | Resultado |
|---|---|
| `npm --prefix apps/web run typecheck` | Aprovado |
| `npm --prefix apps/web test` | Aprovado: 5 arquivos, 45 testes |
| `npm --prefix apps/web run build` | Aprovado; Vite transformou 2.413 módulos |
| `bun test supabase/functions/_tests/worker.test.ts` | Aprovado: 25 testes |
| `npm audit` | Aprovado: 0 vulnerabilidades em dependências de produção e desenvolvimento |
| `supabase db reset` | Aprovado no Supabase local; aplicou as 24 migrations locais em base limpa |
| `supabase test db` | Aprovado: 10 arquivos, 129 asserções |
| `bash scripts/test_local_concurrency.sh` | Aprovado com duas conexões PostgreSQL; inclui reserva de quota, confirmação concorrente idempotente, reagendamento stale e `SKIP LOCKED` |
| `git diff --check` | Aprovado após alterações finais |
| E2E/visual autenticado | Não executado: ferramenta/configuração e sessão ausentes |
| Lint | Não executado: não há script nem dependência de lint configurados |

### Falha intermediária registrada

A primeira execução do teste de concorrência idempotente falhou: a fixture aumentou o limite antes de existir a linha de ciclo de uso e as confirmações de fixture encontraram quota esgotada. O ajuste foi movido para depois do caso que valida limite 1. A execução final passou. A primeira tentativa do script de `EXPLAIN` também não recebeu privilégio para uma tabela temporária; foi corrigida com `GRANT SELECT` apenas na fixture local e reexecutada.

## Homologação funcional

**Comprovado automaticamente:** isolamento e permissões por workspace em pgTAP; validação/atomicidade de confirmação de lote; quota; idempotência; estados e reconciliação do worker; filtros SQL; paginação filtrada que encontra lote fora da primeira página; cancelamento/reagendamento e estados inválidos; ordem de carrossel; grupo; limpeza apenas em dry-run; locks com conexões concorrentes.

**Não homologado visualmente ou com serviços reais:** login pela interface, troca de workspace no navegador, upload real ao Storage, OAuth TikTok, resposta real de `creator_info`, Direct Post/Inbox no TikTok, conteúdo CSV selecionado na UI e interação visual com modais/tabelas. As suítes automatizadas usam dados e respostas simulados; não equivalem a esses testes manuais.

Não foram criados vídeos ou publicações reais. A operação de retenção continuou em dry-run; não houve exclusão física.

## Alterações de estabilização

- `confirm_publication_batch` agora valida chave não nula e adquire lock advisory por workspace e chave antes de consultar/inserir o lote. Duas confirmações simultâneas idênticas devolvem o lote já confirmado à segunda chamada.
- `list_publication_batches` primeiro materializa filtros, pagina lotes por `created_at DESC, id DESC`, calcula agregados apenas para os lotes da página e mantém o total de lotes do conjunto filtrado.
- Índices ajustados para ordenação estável e filtros de conta/grupo/status.
- A FK composta job/lote usa `ON DELETE SET NULL (batch_id)`; workspace permanece intacto e não viola `NOT NULL` durante exclusão da entidade referenciada.
- O script de concorrência verifica confirmação repetida por duas conexões distintas e confirma uma única linha de job.

## Migrações

`supabase db reset` aplicou em base local limpa a sequência de 24 arquivos presentes em `supabase/migrations`, incluindo `20261103000001`, `20261103000002` e a migration incremental `20261103000003_allow_image_media_uploads.sql`. `supabase migration list --local` confirmou o ledger local completo. Esse comando não consultou projeto remoto nem comprova o histórico remoto. As migrations de grupos/lotes e a migration de MIME continuam alterações locais do worktree; não foram enviadas nem aplicadas remotamente.

## Bloqueios e pendências

- Autenticar uma sessão de homologação local e percorrer visualmente desktop/mobile.
- Homologar OAuth e `creator_info` com app e contas TikTok oficialmente autorizadas, depois da aprovação apropriada fora do Sandbox.
- Confirmar callback OAuth/domínio HTTPS verificado no ambiente de homologação; fotos/carrosséis dependem de domínio verificado para `PULL_FROM_URL`.
- Conferir o estado do ledger remoto antes de qualquer publicação futura das migrations; nenhuma verificação remota ocorreu nesta fase.
- Validar upload com JPEG/PNG/WebP em homologação local pela API de Storage; pgTAP confirmou configuração do bucket, mas nenhum arquivo binário foi enviado.
- Fazer ensaio de restauração de backup e de compatibilidade deploy old/new antes da implantação.
- Repetir medições com dados reais de homologação, volume e hardware comparáveis ao ambiente contratado.

Consulte [auditoria de segurança](SECURITY_AUDIT.md), [baseline de desempenho](PERFORMANCE_BASELINE.md) e [runbook](DEPLOY_RUNBOOK.md).

## Atualização da Fase 3.5

As pendências locais de Playwright autenticado, upload binário e backup/restauração foram reavaliadas em `PHASE_3_5_E2E_HOMOLOGATION.md`. A Fase 3.5 executou 11 casos E2E aprovados (3 skips intencionais), testou JPEG/PNG/WebP/MP4 contra Storage local e restaurou um dump PostgreSQL em banco local isolado. A homologação integrada permanece parcial: CSV, confirmação/repetição/cancelamento/reagendamento visuais e uma limitação do Storage em validar conteúdo por assinatura continuam pendentes. O detalhamento da Fase 3.5 substitui as pendências antigas deste documento.
