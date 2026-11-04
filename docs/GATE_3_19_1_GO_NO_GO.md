# Gate 3.19.1 — GO/NO-GO

## Decisão por escopo

| Escopo | Decisão | Evidência |
|---|---|---|
| Correções locais | **GO com ressalvas** | Lease/fencing, CAS, reautorização conservadora e correção E2E implementados localmente; migration 10 ainda não implantada. |
| Testes locais | **GO com ressalvas** | Bun 109/109, pgTAP 246, harness concorrente 48, Vitest 45/45, Playwright descartável 20/20, typecheck web, build, TypeScript Edge direcionado, pacote Node read-only 59/59 e `git diff --check` aprovados. Deno não está instalado e lint geral não está configurado; Shop OAuth precisa confirmação do contrato oficial específico. |
| Solicitar autorização de staging | **NO-GO neste Gate** | Contrato Shop incompleto; Cloud segue divergente, migration 10 não implantada; backup/restore, RLS/Storage runtime, RPCs e `pg_net` pendentes. |
| Executar staging | **NO-GO** | Não autorizado nem preparado operacionalmente; exige projeto isolado e aprovações por migration/serviço. |
| Produção | **NO-GO** | Nenhuma homologação end-to-end nem evidência de rollback/backup e integrações reais. |

## Blockers para staging

1. Confirmar contrato de resposta TikTok Shop (campos de expiração, rotação, timeout e endpoint) em documentação oficial específica do app.
2. Migration 10 é uma nova migration LOCAL_ONLY; revisar hash, rollback/restore e rollout coordenado antes de qualquer staging.
3. As nove migrations previamente pendentes e a nova M10 precisam de aprovação individual, comparação de drift e ensaio.
4. Reconciliar RPCs, schema, RLS, Storage, grants e `pg_net` com ambiente dedicado; metadados do Gate 3.18 não são teste runtime.
5. Backup e restauração, segredos, logs e cron/cleanup permanecem pendentes; limpeza física segue desligada.

## Próximo gate recomendado

Executar revisão independente da migration 10 e do contrato TikTok Shop; em seguida, reconciliar o estado com um ambiente staging dedicado e obter autorização separada para preparar — não ainda executar — staging. Qualquer acesso ou mutação remota requer autorização específica posterior.

