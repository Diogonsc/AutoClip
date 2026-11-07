# AutoClip — baseline de desempenho SQL (local)

**Data:** 2026-11-01. Banco Supabase local; todas as fixtures são fictícias e revertidas com `ROLLBACK`.

## Método

Foram criados três workspaces e **11.100 lotes/jobs** no total (100, 1.000 e 10.000 por workspace; um job por lote). Os status foram distribuídos entre `PUBLISHED`, `SCHEDULED`, `FAILED` e `UNKNOWN`. O banco foi analisado com `ANALYZE`; `EXPLAIN (ANALYZE, BUFFERS)` invocou a RPC real `list_publication_batches` com claims de usuários autenticados e, em separado, examinou os filtros/página/agregação equivalentes. Nenhum dado permaneceu após o rollback.

As medições abaixo comparam as saídas guardadas da mesma fixture, mesmos parâmetros, banco local e comando antes/depois da otimização. Execuções são sequenciais e com cache local aquecido; não representam latência de rede nem capacidade garantida de produção.

## RPC paginada: antes e depois

| Workspace/consulta | Antes | Depois | Variação observada |
|---|---:|---:|---:|
| 100 lotes, sem filtro | 4,824 ms | 5,644 ms (mediana) | +17%; sem melhoria mensurável, ruído de execução |
| 1.000 lotes, status `SCHEDULED` | 4,007 ms | 4,033 ms (mediana) | praticamente igual |
| 10.000 lotes, filtro por conta | 79,239 ms | 17,291 ms (mediana) | -78,2% |
| 10.000 lotes, filtro por período | 71,485 ms | 10,529 ms (mediana) | -85,3% |
| 10.000 lotes, grupo + status | 36,975 ms | 24,239 ms (mediana) | -34,4% |

Para o estado otimizado, foram feitas três execuções sequenciais: filtro por conta variou de 13,033 a 30,907 ms; período, de 5,551 a 14,616 ms; grupo+status, de 19,826 a 24,790 ms. A tabela usa mediana, não o melhor resultado. Os dois cenários menores também foram repetidos três vezes.

O tempo é a execução end-to-end da RPC no `EXPLAIN`; PostgreSQL não mostra os planos internos de uma função PL/pgSQL no plano externo. Foram examinados também os filtros SQL equivalentes. Na consulta paginada sem filtro, o plano usa `Index Only Scan` em `publication_batches_workspace_idx` e devolveu 25 lotes em ~0,053 ms na fixture. Agregados por lote usam `publication_jobs_batch_idx`/`publication_jobs_batch_status_idx`; o filtro de grupo usa `account_group_members_workspace_group_channel_idx`; canal usa `publication_jobs_workspace_channel_batch_idx` quando aplicável. A consulta de grupo/status em 10k percorreu as linhas sintéticas necessárias e levou ~39,7 ms no SQL equivalente sem RLS; a chamada autenticada à RPC ficou em ~18,3 ms.

## Otimização aplicada

- Paginação (`LIMIT/OFFSET`, com ordenação `created_at DESC, id DESC`) ocorre antes de calcular estatísticas detalhadas, que são computadas somente para os até 25 lotes da página.
- `total` continua sendo contado sobre a CTE completa e filtrada, antes da paginação.
- Cada linha da página ainda agrega todos os jobs do lote; o filtro de status determina quais lotes aparecem, não remove jobs dos indicadores daquele lote.
- O índice de lotes inclui `workspace_id, created_at DESC, id DESC`. Índices compostos locais cobrem associações de grupo, status/batch e canal/batch.

Uma tentativa exploratória de consulta SQL direta com `authenticated` levou 2,6–5,3 s por avaliar as políticas RLS para muitas linhas; esses scans não são a rota do histórico, que usa a RPC `SECURITY DEFINER` com validação explícita de membership/workspace. Os `EXPLAIN` equivalentes repetidos depois como role local `postgres` ficaram em 23,5 ms para filtro de status, 35,5 ms para grupo e 27,8 ms para grupo/status com agregação, usando `Seq Scan` em 11,1 mil jobs, `publication_jobs_workspace_channel_batch_idx`, `account_group_members_workspace_group_channel_idx` e `publication_jobs_batch_status_idx`. O planner escolheu scan sequencial para a tabela pequena da fixture; isso não é evidência de custo em escala maior. O índice de ordenação de página foi `Index Only Scan` e período/canal usaram os índices por workspace/batch. Leituras diretas de detalhes permanecem limitadas ao lote e paginadas.

## Limitações

- Somente um job por lote, três workspaces, um canal por workspace e distribuição sintética de status. Não mede lotes de 500 itens, concorrência de leitura, IO frio, rede ou produção.
- Cache estava aquecido. Timestamps concentrados em poucas horas; seletividade de período não representa histórico de anos.
- O plano do PostgreSQL pode mudar com distribuição, estatísticas e versão. Repetir `EXPLAIN (ANALYZE, BUFFERS)` em homologação antes de ajustar mais índices.
- As funções seguras são chamadas pela RPC. Evite mover o histórico para uma consulta direta da tabela sem medir o custo das políticas RLS.
- Não afirmar capacidade comercial com base nesses tempos locais. Repetir com dados anonimizados de homologação e recursos do plano de hospedagem escolhido.
