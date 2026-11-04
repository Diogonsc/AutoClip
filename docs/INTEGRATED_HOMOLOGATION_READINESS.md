# Prontidão para homologação integrada — AutoClip

## Estado executivo

**Ainda não pronto para homologação com usuários reais.** O repositório contém implementações e testes locais de frontend, banco e worker; a contenção da role temporária foi confirmada pelo proprietário. Nenhuma dessas evidências comprova que as migrations/código atuais estão implantados ou íntegros no Supabase Cloud, Vercel ou TikTok.

## Matriz de implementação e validação

| Área | Implementação local | Teste local | Implantado remotamente | Homologado real |
|---|---|---|---|---|
| React/Vite e fluxos de lotes | Código presente no worktree; alterações atuais ainda não versionadas | Vitest, typecheck/build e Playwright foram reportados em fases anteriores; reexecutar na baseline do piloto | NÃO VERIFICADO; nenhum deploy nesta etapa | PENDENTE sessão autenticada e revisão visual |
| PostgreSQL/migrations | 29 migrations presentes localmente conforme contagem atual do repositório | Supabase local 17.6/pgTAP e resets foram reportados; conferir novamente na fase integrada | Ledger/schema Cloud NÃO VERIFICADOS; Gate 3 falhou antes de grants | PENDENTE comparação Cloud autorizada |
| Auth/multi-tenancy/RLS | Policies e funções no código/migrations locais | Testes pgTAP locais e fixtures multi-workspace | Configuração e policies implantadas NÃO VERIFICADAS | PENDENTE negativos em staging/cópia aprovada |
| Upload/Storage | Fluxos e segurança de mídia implementados no código local | E2E/local Storage e worker relatados em fases anteriores | Buckets, policies e objetos Cloud NÃO VERIFICADOS | PENDENTE upload/retention em ambiente de teste |
| Worker Docker/HMAC/FFmpeg | `video-worker-api`, worker e Compose locais | Processamento completo local relatado; testes de parser e tarefa no Supabase local | Edge Function e credenciais Cloud NÃO VERIFICADAS | PENDENTE boot/linger, concorrência de duas instâncias e falhas de promoção |
| TikTok OAuth | Integração presente em código local | Sandbox/fixtures locais; OAuth real não executado | App/scopes/secrets/callback Cloud NÃO VERIFICADOS | PENDENTE conta/app de homologação aprovado |
| Agendamento/filas | Lotes, idempotência, quotas, retries e recuperação implementados localmente | Testes locais de concorrência e banco relatados | Jobs e filas Cloud NÃO VERIFICADOS | PENDENTE recuperação de falha e deduplicação em staging |
| Publicação Direct/Inbox | Estados e lógica presentes localmente | Testes locais sem publicação real | NÃO VERIFICADO | PENDENTE homologação separada; confirmação TikTok necessária |
| Backup/restore | Scripts locais existentes | Restauração PostgreSQL local relatada; bytes Storage não incluídos em pg_restore | Backup Cloud/PITR/Storage NÃO VERIFICADOS | PENDENTE prova de restauração coordenada |
| Observabilidade/incidentes | Runbooks locais existem | Testes locais de logs/health parcial | Alertas e logs Cloud NÃO VERIFICADOS | PENDENTE alarmes, responsável e exercício de incidente |
| Billing/checkout | Fora do escopo atual | Não implementar/testar cobrança nesta fase | NÃO IMPLANTADO/AVALIADO | Reservado à última fase do roadmap |

## Dependências antes de entrar em homologação

1. Aprovar uma auditoria read-only por componente, com Project Ref, host, credencial, janela e arquivos/hash explícitos; a role auditora atual permanece NOLOGIN e não deve ser reutilizada.
2. Comparar ledger remoto, schema, funções, policies RLS e grants; decidir migrations somente depois de backup e revisão de compatibilidade.
3. Confirmar buckets privados, limites e retenção; inventariar referências sem baixar mídias reais.
4. Comparar Edge Functions implantadas com o código e verificar JWT/secrets por interface autorizada, sem imprimir valores.
5. Homologar usuário/workspace fictício, isolamento entre workspaces e permissões de membro em cópia ou staging aprovado.
6. Verificar inicialização do worker após login/boot na máquina autorizada, concorrência de duas instâncias, lease expirado e falhas antes/durante/depois da promoção.
7. Usar app e contas TikTok de teste aprovados; provar OAuth, upload, Direct/Inbox, confirmação remota, idempotência e tratamento de UNKNOWN sem publicar conteúdo real.
8. Provar backup e recuperação de PostgreSQL e Storage separadamente; revisar plano de rollback (forward-fix, não down automático).
9. Configurar métricas, logs minimizados, alertas, plantão e procedimento de incident response.
10. Manter cobrança desativada; checkout e provedores de pagamento pertencem à última fase.

## Critérios de entrada

- Identidade do ambiente e autorização escrita pelo proprietário.
- Migrações e diferenças Cloud revisadas; backup restaurável disponível.
- RLS/grants testados para usuário, membro e workspace cruzado.
- Storage privado e segredos protegidos.
- Worker healthy, autostart operacional comprovado e recuperação idempotente.
- Conta TikTok de homologação aprovada, sem conteúdo real.
- Critérios de parada, rollback, suporte e responsável nomeado.

Se qualquer item crítico estiver `PENDENTE`, `NÃO VERIFICADO` ou `BLOQUEADO`, não admitir usuários reais.

## Critérios de saída

- E2E autenticado cobre cadastro, workspace, mídia, lotes, edição e estados de publicação.
- Sem vazamento cross-workspace, duplicação, perda de quota ou job órfão nos cenários de falha aprovados.
- Publicação é confirmada pela resposta/estado externo; `UNKNOWN` e `SENT_TO_INBOX` continuam não confirmados.
- Worker reinicia e recupera backlog sem promover mídia sem validação.
- Backups foram restaurados em ensaio e as ações operacionais têm logs rastreáveis.
- Pendências, limites de piloto e plano de reversão foram aceitos formalmente.

## Próximo gate recomendado

**Gate 3.12 — Plano de Auditoria Read-only por Componente e Preparação de Homologação Integrada.** Definir autorizações/credenciais oficiais separadas para PostgreSQL, Auth/Storage/Edge Functions e Vercel; começar por comparação de migrations/schema/RLS. Não executar mutações Cloud nem ativar usuários como consequência automática deste documento.

Referências: [Relatório final Cloud](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md), [Checklist Cloud](CLOUD_SECURITY_CLOSURE_CHECKLIST.md), [Runbook de deploy](DEPLOY_RUNBOOK.md), [checklist de piloto](PILOT_ACTIVATION_CHECKLIST.md).

## Atualização Gate 3.12

O inventário local e os scripts catalog-only foram preparados; ver [inventário de componentes](GATE_3_12_COMPONENT_INVENTORY.md), [comparação local × Cloud](GATE_3_12_LOCAL_VS_CLOUD_COMPARISON.md), [matriz de riscos](GATE_3_12_SECURITY_RISK_MATRIX.md) e [plano integrado](GATE_3_12_INTEGRATED_HOMOLOGATION_PLAN.md). Nenhuma consulta remota foi executada neste Gate; por isso, a coluna “Implantado remotamente” e as pendências de RLS, grants, Storage, Auth, Edge Functions, Vercel, secrets, jobs e ledger permanecem NÃO VERIFICADAS. Isto não aprova entrada em homologação nem altera os critérios de entrada/saída acima.

O smoke Compose de worker/validador passou localmente. No Gate 3.12.1, a investigação mostrou que um worker local persistente podia consumir a fixture antes do worker Compose do E2E; o teste ainda capturava logs sem confirmar a conclusão pela mesma instância. O teste agora detecta workers concorrentes recentes, aguarda e valida heartbeat/conclusão pelo `instance_id` próprio, e só então verifica logs. Passou 3/3 vezes no stack isolado; com worker concorrente ativo, foi recusado antes da criação da fixture. Repetições limitadas não provam ausência total de intermitência. A homologação integrada/Cloud continua pendente.

## Atualização Gate 3.13 — bloqueadores atuais

Os nove relatórios read-only manuais constam em [reconciliação Gate 3.13](GATE_3_13_CLOUD_RECONCILIATION_REPORT.md). 21 migration IDs coincidem e oito versões locais não aparecem no ledger Cloud. As migrations novas de grupos/lotes e validação de mídia não estão refletidas no schema/bucket observado. Foram confirmadas ACLs públicas amplas em `net` e EXECUTE authenticated em duas RPCs SECURITY DEFINER; os corpos implantados não foram comparados. RLS catalogada ainda precisa de teste cross-workspace runtime. Auth, Edge/secrets, Vercel, cron configurado, TikTok, backup/restore Cloud e observabilidade seguem não verificados.

**Decisão:** NO-GO para homologação com usuários reais, publicação real, ativação de cleanup, deploy ou aplicação de migrations. Entrada em sandbox isolado exige primeiro triagem das RPCs/`pg_net`, revisão e aprovação da cadeia de migrations, e definição das autorizações não-SQL. Nenhuma cobrança/checkout está incluída.

## Atualização Gate 3.14 — triagem de RPCs, pg_net e migrations

A análise local e as propostas de correção estão em [GATE_3_14_SECURITY_TRIAGE_AND_REMEDIATION_PLAN.md](GATE_3_14_SECURITY_TRIAGE_AND_REMEDIATION_PLAN.md). O teste pgTAP adicional cobre duas RPCs sensíveis com fixtures sintéticas; os 21 casos passaram no Supabase local. Isso valida somente as migrations/código locais usados pelo banco de teste. Não houve mudança em código de produção ou Cloud. Permanecem bloqueadores: ACL pública observada em `net`, corpos Cloud das RPCs não comparados, política de resolução de `UNKNOWN` pendente de decisão, oito migrations ainda não aplicadas/revisadas para rollout e verificações runtime de RLS/Storage ainda necessárias. A decisão continua **NO-GO para homologação integrada com usuários reais**.

## Atualização Gate 3.15 — hardening local

A proposta local de autorização central para mudança de plano e resolução de `UNKNOWN`, com chave de idempotência, está em [GATE_3_15_LOCAL_SECURITY_HARDENING.md](GATE_3_15_LOCAL_SECURITY_HARDENING.md). A migration 09 e o frontend correspondente passaram em PostgreSQL local isolado, pgTAP, Vitest, typecheck e build. A mudança é incompatível com o bundle anterior na assinatura da RPC de resolução e exige rollout coordenado se um dia for aprovada. Nada foi aplicado ao Cloud. `pg_net`, Storage/RLS runtime, secrets, configuração das Edge Functions e as oito migrations originais continuam pendentes; portanto, homologação real permanece **NO-GO**.
