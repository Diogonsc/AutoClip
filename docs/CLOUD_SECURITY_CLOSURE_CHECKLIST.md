# Checklist de encerramento de segurança Cloud — AutoClipe

Este checklist não autoriza alterações. Um item só pode ser marcado **APROVADO** quando houver evidência rastreável do ambiente remoto correto e da janela indicada. Testes locais são **VALIDADO LOCALMENTE**, não aprovam controles Cloud.

| Área | Estado | Evidência atual / critério para aprovação |
|---|---|---|
| Identidade do projeto | APROVADO (preflight histórico) | Project Ref `djrwfvcxgpyknmizqumn`; Direct host e TLS `verify-full` foram confirmados no Gate 0 pelo proprietário. Reconfirmar antes de outra sessão administrativa. |
| Role `autoclip_cloud_auditor` | APROVADO (contenção observada) | Diagnóstico pós-COMMIT local: presente, marcador correto, `can_login=false`, sem atributos admin; hash/script na auditoria final. |
| Remoção da role e credencial | PENDENTE | Role ainda existe, validade até 15/11/2026 e membership `postgres` → auditora. Exige preflight novo e autorização para remover membership específica e DROP sem CASCADE. |
| PostgreSQL: grants e ACLs | PENDENTE | Relatório Gate 3.3 identificou 45 ocorrências; inventário completo de ACLs por objeto/role ainda não consolidado. Inclua CONNECT, TEMP, USAGE, CREATE, SELECT, DML, MAINTAIN, EXECUTE, sequences, large objects e grant options. |
| PostgreSQL: `PUBLIC` e `pg_net` | BLOQUEADO PARA PILOTO | Gate 3.3 reportou privilégios públicos em objetos pg_net. Efeito, alcançabilidade por schema e funções HTTP precisam revisão independente; não revogar globalmente sem avaliação de impacto. |
| Memberships e ownership | PENDENTE | Role auditora sem membership efetiva e nenhuma dependência compartilhada no instante do diagnóstico; aresta postgres como membro permanece. Auditar roles restantes e ownership Cloud. |
| RLS por workspace | PENDENTE | Migrations/testes locais não demonstram RLS implantada Cloud. Comparar policies, FORCE RLS, owners, grants e testes negativos em ambiente isolado autorizado. |
| SECURITY DEFINER/RPCs | PENDENTE | Não foi feito inventário Cloud abrangente de owners, search_path, EXECUTE e dependências. Revisar sem invocar funções da aplicação. |
| Supabase Auth | NÃO AVALIADO | Provedores, redirect URLs, MFA, sessão, emails e controles de usuário não foram consultados. Revisar metadados sem exportar usuários, hashes ou tokens. |
| Edge Functions | NÃO AVALIADO | O repositório tem 12 diretórios de funções com entrypoint e dois diretórios auxiliares (`_shared`, `_tests`); correspondência, versão implantada, verify_jwt e secrets Cloud não foram verificados. |
| Storage | NÃO AVALIADO | Buckets, privacidade, políticas, limites, metadados agregados e referências órfãs Cloud não foram inventariados nesta conclusão. Não baixar objetos nem gerar signed URLs. |
| Segredos / TikTok OAuth | NÃO AVALIADO | Nenhum token, secret ou configuração de integração foi inspecionado. Revisar armazenamento, escopos, rotação e callbacks em fluxo autorizado. |
| Logs e rastreabilidade | PENDENTE | Há relatórios locais protegidos e relato do operador; logs administrativos Cloud e alertas não foram consultados. Definir retenção e trilha de mudanças. |
| Retenção de mídia | VALIDADO LOCALMENTE | Testes e migrations locais existem; política Cloud, estado de objetos e retenção real não foram verificados. |
| Backups e recuperação | VALIDADO LOCALMENTE / PENDENTE CLOUD | Restauração local foi relatada. Backup Cloud, PITR, recuperação de configuração e cópia separada de bytes Storage precisam prova. |
| Isolamento multi-tenant | VALIDADO LOCALMENTE / BLOQUEADO PARA PILOTO | pgTAP e fixtures locais cobrem isolamento; ausência de verificação Cloud impede aprovação. |
| Quotas, reservas e cobrança | VALIDADO LOCALMENTE / PENDENTE CLOUD | Lógica local existe. Confirmar integridade/reconciliação Cloud; cobrança permanece desativada e reservada à última fase. |
| Filas, retries, idempotência | VALIDADO LOCALMENTE / PENDENTE CLOUD | Testes locais não provam estado, concorrência ou duplicação Cloud. Homologar jobs/recovery em cópia/ambiente autorizado. |
| Worker e observabilidade | VALIDADO LOCALMENTE / PENDENTE OPERACIONAL | Compose/HMAC/health local foram testados. `linger`/boot, concorrência entre duas instâncias e falhas intermediárias de promoção ainda requerem evidência. |
| TikTok Direct/Inbox e confirmação | PENDENTE | Nenhuma publicação real foi feita. `UNKNOWN` e `SENT_TO_INBOX` não são confirmação de publicação; homologar com app/conta de teste aprovados. |
| Deploy, rollback e domínio | NÃO AVALIADO NESTE GATE | Nenhum deploy Vercel/Edge foi feito. Exigir artefato identificado, janela, migrações comparadas, backup, rollback e critérios de parada. |
| Teste integrado de usuários reais | BLOQUEADO | Não liberar usuários até aprovação de Auth/RLS, Storage, OAuth, worker, publicação, suporte, observabilidade, backups e incident response. |

## Autorizações ainda necessárias

- Auditoria catalog-only Cloud por escopo e identidade aprovados.
- Auditorias separadas de Auth, Storage, Edge Functions e Vercel por interfaces oficiais read-only.
- Consulta agregada operacional de jobs/mídias somente após escopo e minimização aprovados.
- Remoção da role temporária em gate próprio.
- Homologação TikTok e integrada em ambiente de teste autorizado.
- Qualquer migration, alteração de ACL/RLS, secret, bucket ou deploy exige aprovação específica do proprietário; este checklist não autoriza nenhuma delas.

## Referências

- [Relatório final da auditoria Cloud](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md)
- [Prontidão de homologação integrada](INTEGRATED_HOMOLOGATION_READINESS.md)
- [Checklist existente de ativação do piloto](PILOT_ACTIVATION_CHECKLIST.md)

## Atualização Gate 3.12

O inventário estático, matriz de riscos, pacote SQL catalog-only e plano de homologação estão em [inventário de componentes](GATE_3_12_COMPONENT_INVENTORY.md), [matriz](GATE_3_12_SECURITY_RISK_MATRIX.md), [comparação local × Cloud](GATE_3_12_LOCAL_VS_CLOUD_COMPARISON.md) e [plano integrado](GATE_3_12_INTEGRATED_HOMOLOGATION_PLAN.md). Os scripts de componente e o wrapper estão documentados em `scripts/cloud-audit/component-readonly/README.md`. Foram preparados/testados localmente, mas **nenhum foi executado no Cloud**. Logo, linhas remotas deste checklist continuam PENDENTE/NÃO AVALIADO e não mudam para APROVADO por causa destes artefatos.

## Atualização Gate 3.13

Os nove componentes PostgreSQL read-only foram executados manualmente pelo proprietário; ver [relatório de reconciliação](GATE_3_13_CLOUD_RECONCILIATION_REPORT.md). A auditoria confirmou metadados de ACL/RLS/rotinas/Storage/extensões, mas **não aprova** esses controles: `pg_net` tem ACL pública ampla, duas RPCs SECURITY DEFINER têm EXECUTE para authenticated, oito migrations locais não constam no ledger Cloud e a cadeia de validação/quarentena não aparece no inventário remoto. Homologação continua **BLOQUEADA** até revisão desses riscos, testes isolados e verificação não-SQL. Cron rows/commands, sessões da role, Auth, Edge/secrets, Vercel, TikTok e funcionamento runtime seguem NÃO AVALIADOS. Nenhuma alteração Cloud foi feita.
