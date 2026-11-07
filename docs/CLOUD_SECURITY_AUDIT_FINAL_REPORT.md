# Relatório final — auditoria de segurança Supabase Cloud

> **Escopo temporal:** este documento consolida o Gate 3.11 e a evidência histórica fornecida pelo proprietário. O inventário estático e o pacote read-only preparados no Gate 3.12 estão documentados separadamente nos [artefatos Gate 3.12](GATE_3_12_COMPONENT_INVENTORY.md); eles não são execução Cloud nem alteram os estados remotos abaixo.

**Projeto:** AutoClipe · **Project Ref:** `djrwfvcxgpyknmizqumn` · **Database:** `postgres`

**Resultado do Gate 3.11:** contenção NOLOGIN confirmada por evidência do proprietário e diagnóstico independente; auditoria Cloud abrangente e homologação de produção permanecem pendentes.

## 1. Resumo executivo

Os Gates 3.6–3.10 prepararam e exercitaram uma auditoria de metadados controlada, investigaram permissões inesperadas da role temporária e desativaram logins diretos da `autoclip_cloud_auditor`. O diagnóstico independente mais recente fornecido pelo proprietário mostra `can_login=false`, atributos administrativos desativados, nenhuma sessão ativa e nenhuma dependência compartilhada reportada. A role continua existindo, tem `CONNECT=true` e `TEMP=true` efetivos e mantém uma aresta de membership em que `postgres` é membro da role auditora com `ADMIN OPTION`.

O histórico do Gate 3.3 reporta 45 ocorrências de ACL: 19 de relações, 16 de EXECUTE em rotinas, cinco de sequences e outras ocorrências de database, ledger, membership e schema. Entre elas havia permissões públicas relacionadas a `pg_net`. O Gate 3 nunca concedeu os grants propostos: terminou em ROLLBACK. Não foi concluído um inventário Cloud abrangente de schema, políticas RLS, Storage, Auth, Edge Functions ou dados operacionais. A contenção NOLOGIN reduz a possibilidade de novas autenticações diretas à role, mas não revoga grants, não altera `PUBLIC` e não encerra sessões existentes.

Esta auditoria não conclui que o Supabase esteja integralmente seguro, que a aplicação esteja homologada ou que usuários reais possam ser liberados. Ela encerra documentalmente a contenção observada e classifica as verificações ainda necessárias.

## 2. Escopo e fontes

- Projeto principal informado pelo proprietário: `djrwfvcxgpyknmizqumn`; PostgreSQL Cloud informado como 17.11.
- Evidências Cloud: resultados comunicados pelo proprietário após execução manual dos Gates 0, 1, 2, 3, 3.3, 3.9 e 3.10; o relatório sanitizado de contenção existe localmente em `/home/diogo-nascimento/autoclip-admin-readonly.oMuxIr`.
- O arquivo de contenção local tem modo `0600` e mtime local `2026-11-02 00:25:59 -0300`. Esse mtime não é timestamp assinado pelo servidor. O relatório bruto não foi copiado para este repositório.
- O relatório do Gate 3.3 existe localmente em `/home/diogo-nascimento/autoclip-gate3-diagnostic.M2JAt3`, modo `0600`; seu conteúdo não foi copiado. As 45 ocorrências e categorias abaixo correspondem ao resultado informado pelo proprietário.
- Testes locais foram executados em PostgreSQL 17.6 e não comprovam configuração Cloud.
- Não houve conexão Cloud nesta consolidação. A contenção foi executada anteriormente pelo proprietário, conforme seu relato e o diagnóstico local independente.

## 3. Linha do tempo dos Gates 3.6 a 3.10

| Gate | Objetivo e ação | Evidência / falha | Resultado e limite |
|---|---|---|---|
| 3.6 | Preparar contenção da role e auditoria administrativa read-only. | SQLs e runbook locais; análise dos privilégios herdados. | Preparação local; sem operação Cloud naquele gate. |
| 3.7–3.8.1 | Revisar guard, TLS e diagnóstico da role. | Hashes de scripts; CA `prod-ca-2021.crt` verificado localmente e comparado à cópia entregue pelo proprietário. | Pronto para diagnóstico manual. Fingerprint local conhecido; origem oficial foi informada pelo proprietário. |
| 3.9 | Diagnosticar a role no Cloud. | Proprietário executou o diagnóstico read-only. Role existia com LOGIN, expiração em 15/11/2026, CONNECTION LIMIT 1, sem atributos administrativos e sem sessão reportada. |
| 3.10 / tentativa inicial | Desativar LOGIN. | Erro `permission denied for table pg_authid` antes de ALTER ROLE. | Falha de compatibilidade; essa tentativa não alcançou a mutação. |
| 3.10.2–3.10.4 | Substituir acesso direto a `pg_authid`, testar localmente e preparar execução manual Bash. | `pg_roles` usado para atributos; lock em `pg_authid` removido. Harness local PG 17.6 com operador não SUPERUSER e sem SELECT em `pg_authid`. | Correção testada localmente; permaneceu risco de corrida administrativa. |
| 3.10 — execução final | Conter novos logins com script NOLOGIN corrigido. | Proprietário informou execução pelo wrapper, marcador pós-COMMIT e diagnóstico read-only independente. JSON sanitizado local mostra `can_login=false`, zero sessões e dependências vazias. | Contenção confirmada; role e grants permanecem. Não houve encerramento de sessões nem revogação. |

## 4. Incidente de compatibilidade `pg_authid`

O script original tentava ler e bloquear uma linha de `pg_authid`. O usuário `postgres` do Supabase Cloud não tinha SELECT nesse catálogo; a falha ocorreu antes de qualquer `ALTER ROLE`. O Gate 3.10.2 removeu a leitura direta e o lock, passando a consultar os atributos expostos por `pg_roles`. As chamadas `shobj_description(..., 'pg_authid')` e a referência de classe em `pg_shdepend` não fazem `SELECT FROM pg_authid`.

O harness local testou o script sob uma role administrativa fixture sem SUPERUSER nem SELECT em `pg_authid`, mas com CREATEROLE e ADMIN OPTION necessários à role fixture. Uma sessão TCP autenticada como a role-alvo bloqueou a contenção antes do ALTER; sem sessão ativa, a role fixture chegou a NOLOGIN no banco descartável.

Classificação: **falha operacional de compatibilidade**, sem evidência de comprometimento. Remover o lock introduziu uma limitação real: prechecks e ALTER não são atomicamente protegidos contra outra administração de roles em paralelo. Checks pré/pós reduzem o risco, mas não eliminam a corrida. O procedimento exige janela sem alterações administrativas concorrentes.

## 5. Estado da role e contenção

| Campo | Antes (Gate 3.9) | Depois (diagnóstico independente Gate 3.10) |
|---|---|---|
| Role / marcador | Presente / correspondente | Presente / correspondente |
| LOGIN | `true` | `false` |
| Validade | `2026-11-15T00:43:58+00:00` | Mesmo valor |
| CONNECTION LIMIT | `1` | `1` |
| SUPERUSER, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS | `false` | `false` |
| INHERIT | `false` | `false` |
| Database privileges | CREATE `false`, CONNECT `true`, TEMP `true` | Mesmos valores |
| Membership | `postgres` membro de `autoclip_cloud_auditor`, ADMIN true, INHERIT/SET false | Mesma aresta; memberships efetivas da role auditora: `[]` |
| Sessões | `0` reportadas | `0`; estados agregados vazios |
| Dependências compartilhadas | `[]` reportadas | `[]` |

Script informado para execução: `scripts/cloud-audit/admin-readonly/31_disable_role_nologin.sql`, cujo SHA-256 atual é `335997ae505ebb3d2f58d63ccddb03fcb5488ba18ae94933cbc0fe0278700707`. O proprietário informou que o wrapper executou a contenção; não há recibo criptográfico independente ligando os bytes então executados ao hash atual. O diagnóstico read-only independente posterior confirma o estado persistido `can_login=false`. Não foram revogados grants, encerradas sessões nem removida a role.

## 6. Matriz de evidências

| Controle / evidência | Fonte | Resultado | Data | Limitação | Status |
|---|---|---|---|---|---|
| Destino, TLS Direct/verify-full e PostgreSQL 17.11 | Resultado Gate 0 informado pelo proprietário | Handshake e identidade de sessão confirmados naquela execução | Data não preservada aqui | Não prova configuração atual nem identidade de outros endpoints | CONFIRMADO (relato/evidência Gate 0) |
| Role criada e senha configurada | Gates 1–2, execução pessoal informada | Role existe; senha não é reproduzida nem validada aqui | Data não preservada | Credencial não foi rotacionada/removida neste Gate | CONFIRMADO (relato do proprietário) |
| Grants do Gate 3 | ROLLBACK informado | Nenhum grant do script aplicado | Data não preservada | Não substitui auditoria total das ACLs existentes | CONFIRMADO (resultado informado) |
| Inventário de privilégios (45 ocorrências) | Relatório local Gate 3.3 + contagens informadas | Categorias agregadas documentadas abaixo | Mtime local 01/11/2026 22:30 -0300 | Relatório é textual/local; objetos individuais não foram copiados para o repositório | CONFIRMADO (diagnóstico informado) |
| LOGIN desativado | JSON local `autoclip-admin-readonly.oMuxIr` + execução informada | `can_login=false`; demais atributos compatíveis | Mtime local 02/11/2026 00:25 -0300 | Mtime não é timestamp assinado pelo Cloud | CONFIRMADO (execução do proprietário + saída local) |
| Zero sessões e dependências | Mesmo JSON sanitizado | Contagens/listas vazias no momento do diagnóstico | Igual ao arquivo acima | Não prova ausência de configuração externa ou sessões futuras | CONFIRMADO (instantâneo) |
| Hashes SQL/guard/wrapper | `sha256sum` local neste Gate | Correspondem aos valores publicados | 02/11/2026 | Integridade local não prova quais bytes foram executados em operações anteriores | CONFIRMADO (hashes atuais) |
| Testes de contenção/operador restrito | Harness PostgreSQL local 17.6 | Passaram localmente | Nesta consolidação | Não é teste Cloud | VALIDADO LOCALMENTE |
| Schema Cloud, RLS, grants globais e SECURITY DEFINER | Sem inventário administrativo Cloud completo | — | — | Não é possível inferir ausência a partir do diagnóstico de role | PENDENTE |
| Edge Functions, Auth, Storage, Vercel, jobs/quota | Sem credencial/interface autorizada nesta etapa | — | — | Fora do escopo executado | NÃO AVALIADO |

O relatório Gate 3.3 indicou 19 privilégios de relações, 16 EXECUTE em rotinas, cinco privilégios de sequences, um item de database CREATE/TEMP provenance, um item informativo do ledger, um CONNECT em database não alvo, uma membership e um privilégio de schema. O agregado não revela, por si só, se cada ACL pública era efetivamente alcançável sob todas as pré-condições de schema/RLS; não foi executada função HTTP nem função de aplicação.

## 7. Riscos residuais

| Risco | Evidência / impacto potencial | Probabilidade / severidade | Mitigação atual | Ação recomendada / prioridade | Autorização Cloud |
|---|---|---|---|---|---|
| TEMP herdado de PUBLIC | Diagnóstico da role mostra `temporary=true`; a role pode criar objetos temporários em uma sessão que consiga assumir/usar a identidade. | Probabilidade não quantificada; severidade **ALTA** pelo escopo do proprietário. | LOGIN desativado, validade limitada, CONNECTION LIMIT 1; sem revogação global de PUBLIC. | Remover a role após revisão de dependências e membership; não reativá-la. **P1** | Sim, para revogação/remoção específica. |
| ACLs públicas relacionadas a `pg_net` | Gate 3.3 reportou ACLs em relações/rotinas; execução de rotinas HTTP e acessibilidade efetiva não foram testadas. | Impacto potencial alto; probabilidade não quantificada. | Não usar a role; LOGIN false. Isso não altera grants de PUBLIC nem protege outros roles. | Revisar ACLs e efeitos de cada rotina em escopo separado; não revogar globalmente sem análise de impacto. **P1** | Sim. |
| Rotinas SECURITY DEFINER / funções de aplicação | Gate 3.3 reportou EXECUTE em rotinas; não há auditoria completa de definição/owner/search_path no Cloud nesta etapa. | Evidência insuficiente para afirmar exploração; impacto potencial alto. | Nenhuma função foi executada. | Inventariar propriedades e grants; revisar funções individualmente antes de qualquer mudança. **P1** | Sim, read-only primeiro; alteração separada. |
| Grants em schemas, tabelas, sequences e databases | Categorias agregadas presentes no diagnóstico 45; lista integral de ACLs não consolidada neste relatório. | Desconhecida; impacto potencial médio/alto conforme objeto. | Role sem LOGIN; nenhum grant do Gate 3 aplicado. | Auditoria catalog-only revisada e autorizada; avaliar origem PUBLIC/extensão/AutoClip. **P1** | Sim. |
| Membership da role auditora | `postgres` é membro da role auditora com ADMIN OPTION; direção oposta não foi observada; effective memberships vazias. | Baixa exposição direta após NOLOGIN, mas impede/afeta DROP até tratar a aresta. | NOLOGIN e nenhuma membership efetiva na role. | Preservar evidência; remover somente com autorização explícita durante plano de remoção. **P2** | Sim. |
| Dependências compartilhadas | Diagnóstico reportou zero dependências compartilhadas. | Baixa para dependências catalogadas naquele instante; não cobre configuração externa. | Preflight read-only e DROP futuro sem CASCADE. | Reconfirmar antes da remoção; não usar CASCADE/DROP OWNED. **P2** | Sim. |
| Concorrência administrativa no NOLOGIN | Não foi possível obter lock de linha em `pg_authid`; existe janela entre precheck e ALTER. | Probabilidade não estimada; severidade média. | Validações imediatamente antes e depois; execução em janela sem alterações concorrentes. | Em futuras operações, confirmar janela e reconciliar por leitura se resultado indeterminado. **P2** | Sim para mudança. |
| Reativação administrativa | `NOLOGIN` pode ser revertido por administrador. | Probabilidade não estimada; impacto depende de grants e credential validity. | Registro e hash do script; expiração futura. | Monitorar antes da data de expiração e remover a role; sem reuso. **P2** | Sim. |
| Senha temporária ainda configurada | Gate 2 definiu senha; NÃO houve rotação/remoção confirmada. LOGIN false e expiração 15/11 reduzem janela, mas não removem a credencial. | Probabilidade de uso direto reduzida; severidade média até revogar/remover. | NOLOGIN, validade; senha não exposta neste documento. | Planejar remoção da role; se isso atrasar, solicitar procedimento separado para invalidar credencial, sem presumir que NOLOGIN apaga senha. **P1** | Sim. |
| Logs de alterações administrativas | Evidência local de saída e relato do operador; logs Cloud de auditoria não coletados. | Não quantificada; rastreabilidade incompleta. | Relatórios locais `0600`, hashes e autorizações por gate. | Preservar recibo não sensível e, se autorizado, consultar logs oficiais read-only. **P2** | Sim para consulta de logs. |
| RLS / isolamento multi-tenant Cloud | Testes/migrations locais existem; inventário e testes Cloud não foram executados. | Desconhecida; impacto crítico se incorreto. | RLS e testes locais no repositório. | Comparar policies/grants Cloud e executar negativos apenas em staging/cópia autorizada. **P0** | Sim, com ambiente/testes separados. |
| Edge Functions e autorização de endpoints | Há 12 diretórios locais de funções com entrypoint (`index.ts`), além de `_shared` e `_tests`; deploy/versionamento Cloud não verificado. | Desconhecida; impacto alto. | Testes locais e guards; não prova deploy Cloud. | Verificar via interface oficial read-only; comparar versões, JWT e service-role boundaries. **P1** | Sim. |
| Storage e mídia privada | Nenhum inventário Cloud de buckets/objects/policies foi executado. | Desconhecida; impacto alto para privacidade. | Políticas locais e procedimentos documentados. | Confirmar buckets privados, policies, limites e consistência de referências sem baixar objetos. **P1** | Sim. |
| TikTok OAuth / tokens / secrets | Nenhum segredo ou fluxo real foi auditado nesta fase. | Desconhecida; impacto alto. | Segredos não foram lidos nem impressos. | Revisar armazenamento, rotação, escopos e callbacks em homologação autorizada. **P1** | Sim, read-only de configuração; nunca exportar tokens. |
| Jobs, filas, quotas, lotes e idempotência Cloud | Conteúdo operacional não foi consultado; somente metadados PostgreSQL anteriores. | Desconhecida; impacto alto em duplicação/perda de publicação. | Implementação e testes locais reportados. | Auditoria operacional agregada, backup e reconciliação em ambiente autorizado antes do piloto. **P1** | Sim. |
| Publicação TikTok | `UNKNOWN` e `SENT_TO_INBOX` não significam publicação confirmada. | Dependência externa; impacto comercial. | Estados e restrições documentados localmente. | Homologar Direct/Inbox e confirmação externa com conta/app de teste aprovado; sem conteúdo real. **P1** | Sim, autorização TikTok separada. |
| Backup/recuperação | Ensaios locais foram reportados; não há backup Cloud/Storage verificado neste Gate. | Desconhecida; impacto alto de perda. | Runbook local; backup PostgreSQL não cobre bytes de Storage. | Backup e restore em cópia autorizada, incluindo objetos e configuração. **P1** | Sim. |

## 8. Decisão sobre a role temporária

**Recomendação: manter NOLOGIN apenas como estado de contenção temporário e removê-la em uma operação administrativa futura, após preflight atualizado.** Não há finalidade operacional conhecida para a role; não reutilizá-la para auditoria.

Manter NOLOGIN por curto período preserva evidência e evita uma nova alteração imediata. A role ainda existe, possui senha configurada segundo Gate 2, expira em 15/11/2026 e herda TEMP de PUBLIC. Reavaliar antes dessa data, sem deixar a expiração substituir a revogação planejada.

A remoção exige confirmação read-only de sessões, memberships em ambas as direções, grants/ACLs, ownership e dependências. A aresta `postgres` membro da role auditora precisa ser tratada explicitamente: `DROP ROLE` pode falhar enquanto ela existir. Uma autorização futura deve permitir somente o `REVOKE` dessa aresta identificada, se confirmado, e depois `DROP ROLE` sem CASCADE, com hash e preflight aprovados. Não executar `REASSIGN OWNED`, `DROP OWNED`, `CASCADE` ou revogações globais. TEMP herdado de PUBLIC continuará sendo configuração global e não será alterado por remover essa role.

## 9. Próximo gate e ações prioritárias

1. **P0 — RLS/multi-tenant Cloud:** planejar leitura de policies/grants e teste em ambiente autorizado; não testar invasivamente produção.
2. **P1 — ACLs/pg_net/rotinas:** inventariar cada ACL e rotina, determinar alcançabilidade e efeito; não revogar globalmente.
3. **P1 — Storage, Edge Functions, Auth e secrets:** usar interfaces oficiais read-only autorizadas e registrar não verificados quando inacessíveis.
4. **P1 — Mídia/jobs/quota:** preparar auditoria agregada separada, sem alterar estados nem consultar dados pessoais desnecessários.
5. **P1 — Backup/rollback:** provar restore de PostgreSQL e estratégia separada para bytes de Storage antes de mudança/deploy.
6. **P2 — Role temporária:** autorizar preflight e remoção sem CASCADE como operação separada.
7. **Homologação integrada:** sessão autorizada com usuário/workspace de teste, OAuth e conta TikTok de homologação, worker, filas, idempotência, falha/recovery, monitoramento e publicação confirmada.

Referências: [Checklist de encerramento Cloud](CLOUD_SECURITY_CLOSURE_CHECKLIST.md), [Prontidão de homologação integrada](INTEGRATED_HOMOLOGATION_READINESS.md), [histórico Gate 3.6–3.10](CLOUD_GATE3_6_CONTAINMENT_AND_ADMIN_AUDIT.md), [runbook do wrapper](../scripts/cloud-audit/admin-readonly/README.md).

## 10. Declaração de escopo

O Gate 3.11 não conectou ao Cloud, não executou SQL, não alterou roles/grants/RLS/Storage/Auth, não publicou Edge Functions, não fez deploy, não publicou TikTok, não fez commit/push e não implementou pagamentos. A contenção NOLOGIN é uma evidência anterior do proprietário, confirmada por diagnóstico independente; não é prova de segurança global nem aprovação de produção.
