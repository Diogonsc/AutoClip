# Gate 3.19 — decisão GO/NO-GO

## Decisão deste Gate

**Status documental: GATE 3.19 — PARCIAL / EVIDÊNCIAS PENDENTES.** A reconciliação local e os testes disponíveis foram concluídos, mas a validação do contrato TikTok oficial, os testes de concorrência do TokenStore e o E2E em stack descartável permanecem pendentes. Isso mantém NO-GO para staging e produção.

| Decisão | Estado | Fundamentação |
|---|---|---|
| Continuar revisão/preparação local | **GO** | Inventário, reconciliação documental, testes locais isolados e plano foram concluídos. |
| Solicitar autorização para staging | **NO-GO agora** | HIGHs de RPC, `pg_net`, mídia/Storage, token rotation, migrations/drift e configurações externas permanecem. Preparar correções e provas antes de pedir autorização. |
| Implantar qualquer migration no Cloud | **NO-GO** | Nenhuma das nove migrations foi reconciliada por conteúdo; rollout/restore e dependências de Edge/worker/Storage ainda não testados no staging. |
| Produção / liberar usuários reais | **NO-GO** | Não há homologação end-to-end, observabilidade/backup/recovery provados nem validação real de OAuth/publicação. Gate 3.19 não aprova produção. |

## Critérios de GO para pedir staging

Todos precisam ser verdadeiros antes de solicitar a autorização do ambiente de staging:

1. Ambiente isolado, project ref/endpoints e secrets exclusivos confirmados; nenhuma ligação com produção.
2. Backup e restore completos aprovados em clone isolado e RPO/RTO conhecidos.
3. Hash/revisão de cada migration e Edge/frontend compatível aprovada individualmente; comparação do schema real e corpos RPC resolvida.
4. `change_workspace_plan` só executável por operador confiável na lógica implantada; Owner/Admin comum negado e sem caminhos alternativos de quota.
5. `resolve_unknown_job` com `request_id` e stub antigo fail-closed validado através de PostgREST, schema cache, bundle atual e cache legado; sem efeitos nos clientes antigos.
6. `pg_net`: exposição e caller efetivo compreendidos; nenhum acesso HTTP não autorizado; regressão cron/worker aprovada. Não fazer REVOKE sem prova e approval.
7. RLS, RPC, DELETE e Storage cross-workspace testados com workspaces sintéticos A/B; nenhuma transferência de `workspace_id` ou mídia indevida.
8. M03–M05 ensaiadas com tamanho de dados representativo, locks/WAL/duração aprovados e mídia legada revalidada; M06–M08 compatíveis com Edge/worker.
9. OAuth Content Posting e Shop: contrato oficial/datas confirmados; refresh rotation concorrente e gravação token+expiry atômica testada; segredos/logs revisados.
10. Cleanup físico desligado, dry-run por padrão e fault-injection sem delete; qualquer ativação terá gate próprio.
11. Filas/quota/retries/idempotência/UNKNOWN e recovery após restart/timeout testados; sem duplicação ou saldo inconsistente.
12. Logs sem credenciais, alertas para worker/OAuth/jobs/quotas, documentação de rollback e critérios de parada testados.
13. Nenhum CRITICAL ou HIGH bloqueante sem mitigação formal e aceite escrito do proprietário.
14. E2E/Playwright repetível em stack realmente descartável, sem alterar o Supabase local persistente compartilhado.

## Critérios de NO-GO imediatos

- Projeto ou migration/hash divergente ou não identificado.
- Uso de service role no frontend ou exposição de token/secret.
- Falha de autorização cross-workspace ou body Cloud RPC não reconciliado.
- `pg_net` acessível por caminho não justificado, sem contenção testada.
- `media_assets` marcada READY sem validação confiável ou bucket/policy diferente do esperado.
- Retry/timeout pode duplicar publicação/consumo de quota.
- Refresh token rotacionado não é persistido atomicamente ou resultado de refresh é ambíguo.
- Cleanup pode remover mídia com job `UNKNOWN`, ativo ou referência compartilhada.
- Teste ou restore toca produção, secrets ou dados reais.
- Qualquer erro pós-commit sem diagnóstico da state persistida.

## Próxima ação recomendada

1. Gate 3.19.1 local: preparar testes unitários/integration para refresh rotation concorrente (Content Posting e Shop) e ajustar store com CAS/locking após revisão específica; primeiro obter contrato oficial por documentação autorizada.
2. Gate 3.19.2 local: finalizar revisão de `pg_net`/Storage policies e testes cross-workspace isolados, corrigindo apenas código/migrations locais após autorização correspondente.
3. Gate 3.19.3: obter revisão dos nove SQLs e planejar backup/restore em staging dedicado.
4. Solicitar autorização separada para criação/uso de staging; autorizar cada migration/deploy/teste em subgates individuais.

Este resultado não autoriza o Gate 3.20, staging, Cloud, publicação, limpeza, cobrança ou produção.

Referências: [reconciliação](GATE_3_19_SECURITY_RECONCILIATION.md), [migrations](GATE_3_19_MIGRATION_MATRIX.md), [staging](GATE_3_19_STAGING_PLAN.md), [riscos](GATE_3_19_RISK_REGISTER.md).
