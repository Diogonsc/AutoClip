# Gate 3.19.1 — Blockers locais e riscos ainda abertos

## Corrigido localmente nesta etapa

- Corrida de refresh Login Kit e gravação sem fencing: substituída por lease persistente + attempt ID + `token_version` + CAS.
- Refresh Shop concorrente: os dois consumidores (`tiktok-shop` e `tiktok-shop-publish`) agora usam helper comum e RPCs de claim/complete/fail.
- Resposta ambígua: não repetir o token antigo; exigir reautorização se não for possível confirmar a geração persistida.
- Runner Playwright que dependia do Supabase persistente: passou a exigir wrapper de projeto Supabase temporário com project id, portas e diretório próprios.

## Ainda bloqueante para staging

| Área | Evidência local | Situação Cloud | Bloqueio |
|---|---|---|---|
| RPC `change_workspace_plan` e `resolve_unknown_job` | M09 local restringe chamadas; stub legado fail-closed; pgTAP/harness local. | Gate 3.18 ainda observou as assinaturas antigas com `authenticated EXECUTE`; equivalência posterior não comprovada. | Reconciliar e aprovar migration separadamente. |
| Mídia/RLS/Storage | M04–M08 locais acrescentam quarentena, validação e atestado. | Snapshot Cloud anterior diverge e não demonstra políticas runtime atuais. | Provar schema, policies e A/B em staging isolado. |
| `pg_net` | Gate 3.18 observou `PUBLIC EXECUTE` em 12 rotinas e USAGE observável em `net`. | Caller efetivo/exposed schemas e dependências Supabase não completamente conhecidos. | Não revogar genericamente; revisão/decisão separada. |
| Rotação OAuth | Migration 10 e testes locais atuais. | Não implantada; Cloud permanece sem este mecanismo. | Não conectar clientes ao código novo antes do schema coordenado. |
| TikTok Shop | Mecanismo local alinhado ao padrão de lease; contrato público não totalmente confirmado. | Não testado com provedor real. | Confirmar contrato oficial em gate de staging, com conta autorizada. |
| Backfill M04 | SQL local altera status existentes em massa. | Volume, locks e WAL do Cloud não medidos. | Ensaio em clone/restauração com dados representativos antes da autorização. |
| Cron/cleanup | Código e defaults locais revisados em gates anteriores. | Execução e configuração remotas não observadas. | Cleanup físico continua desligado; verificar cron sem disparar. |
| Backup, Auth, Edge/Vercel, segredos, logs | Há código e checklists locais. | Evidência operacional externa ausente. | Revisão manual oficial, sem exportar segredos. |

## Parecer

As mudanças desta etapa são propostas versionadas localmente, não mudanças implantadas. Os testes não validam isolamento real de tenants no Cloud, política de logs do provedor nem publicação. Sem reconciliação e staging separado, a decisão para staging e produção permanece **NO-GO**.
