# AutoClipe — Marco B.2-B: ficha de autorização e execução controlada

**Estado nesta revisão: preparação somente. Nenhum acesso ao Supabase Cloud foi realizado e nenhum gate foi executado.** A aprovação deste documento não é implícita; cada gate requer autorização nova após o resultado do anterior.

## Destino e operador

| Campo | Valor |
|---|---|
| Project Ref | `djrwfvcxgpyknmizqumn` |
| Ambiente | Projeto principal Cloud do AutoClip |
| Database | `postgres` (esperado) |
| Role proposta | `autoclip_cloud_auditor` |
| Operador previsto | Codex no ambiente local do proprietário, sujeito a confirmação explícita |
| Ferramenta | `psql` local disponível: PostgreSQL client 18.6; servidor Supabase local testado separadamente em PostgreSQL 17.6 |
| Host oficial | **PENDENTE — proprietário deve obter no painel Supabase** |
| Porta | **PENDENTE — proprietário deve confirmar no painel** |
| Tipo de conexão | Direta, sem pooler, preferida; ainda pendente de confirmação do endpoint oficial |
| Database/usuário administrativo real | **PENDENTE** |
| Método de autenticação administrativa | **PENDENTE**; não fornecer segredo ao Codex em texto, argv ou URL |
| Janela, data e fuso | **PENDENTE** |
| Compatibilidade de TLS no ambiente de execução | `psql` local está disponível; cadeia CA, certificado e hostname do host Cloud não foram testados e só poderão ser verificados após GATE 0 autorizado |

Não instalar ferramentas agora. Antes da futura execução, validar client SSL/TLS com verificação de cadeia e hostname, configuração de CA, acesso interativo e armazenamento de segredo aprovado. Não reduzir TLS para contornar falha. Host esperado no auditor metadata-only é `db.djrwfvcxgpyknmizqumn.supabase.co:5432`; isto **não** é confirmação do host real pelo proprietário.

## Gates independentes

| Gate | Autorização específica | Ação permitida | Critério de parada |
|---|---|---|---|
| 0 — Preflight | Project Ref, host/porta do painel, database, operador, janela, método de autenticação e finalidade da conexão | Uma conexão para identificar a sessão/servidor; consultas mínimas de identidade, TLS e `current_database/current_user`; sem mutação | Qualquer divergência de destino, identidade ou TLS interrompe. GATE 0 não permite SQL administrativo. |
| 1 — Criar role | Aprovação explícita do arquivo e hash de `00_create_role.sql`, além do aceite TEMP separado | Executar apenas guard + script de criação | Role preexistente, hash divergente, falha ou estado parcial: parar; não improvisar recuperação. |
| 2 — Senha | Aprovação específica do procedimento de senha | Prompt psql interativo `\\password autoclip_cloud_auditor` em terminal protegido, senha gerada e armazenada pelo proprietário em gestor local aprovado | Senha não deverá ser digitada ao Codex nem escrita em SQL, shell history, argv, URL, log ou artefato. Se o ambiente não ocultar entrada, parar. |
| 3 — Grants | Aprovação explícita do arquivo e hash de `01_grant_minimum_permissions.sql` | Executar somente o script de grants mínimos | Sem grant extra para contornar ledger incompatível ou permissão negada. Falha: parar. |
| 4 — Verificação | Aprovação explícita do arquivo e hash de `02_verify_metadata_readonly.sql` | Executar verificação read-only e registrar saída minimizada, sem segredo | Resultado não seguro, parcial, timeout ou ACL inesperada: NO-GO; encerrar. Marco C não inicia. |

Antes de cada gate, apresentar o resultado anterior e solicitar autorização do próximo gate. Aprovação genérica cobrindo todos os gates não será usada.

## Scripts aprováveis futuramente e hashes atuais

| Arquivo | SHA-256 | Efeito |
|---|---|---|
| `scripts/cloud-audit/sql/_guard.psql` | `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` | Guard de variáveis, project ref, role e database; não autentica nem prova o host. |
| `scripts/cloud-audit/sql/metadata-only/00_create_role.sql` | `74a7a95cb411b93942df6e386358f25f8e157e979fd6e0600bd48586063adbf4` | Cria a identidade temporária marcada, com flags não administrativas e defaults de sessão. |
| `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` | `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` | CONNECT e grant condicional limitado a `version` do ledger. |
| `scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql` | `49d6d2d6a7550f111fa44e762a7474a16dce3071975a65a6c90829c4e53d5637` | Verificação read-only fail-closed. |

Arquivos de revogação separados e não autorizados por estes gates: `03_emergency_revoke_metadata_role.sql` (`ef6a8e0365caafa657fc0e5ccbdc8ee4d250bb6ec92e2220ab5ef2f1c519ac17`) e `04_remove_metadata_role.sql` (`08da9cff7023f71b3a9205482a4091f0b45dd57f7472729100fece673f1af4bf`). O SQL completo e byte-exato para revisão está no [escopo metadata-only](CLOUD_METADATA_ONLY_AUDIT_SCOPE.md). Recalcular cada hash antes da operação; mudança invalida aprovação anterior.

## Risco TEMP — aceite necessário antes do GATE 1

**Risco ALTO residual:** quando TEMP é herdado de PUBLIC, a role pode criar objetos temporários fora da ferramenta em uma sessão permitida. O programa usa queries allowlisted dentro de transações `READ ONLY`, não remove a capacidade fora dele. Controles compensatórios: identidade temporária, conexão limitada a 1, validade <=14 dias, sem escrita persistente/DDL/ownership/membership, auditor estático, timeouts e revogação preparada. Esses controles reduzem exposição, mas não eliminam o risco. Não revogar TEMP de PUBLIC globalmente.

Aceite específico ainda **PENDENTE** e deverá nomear projeto, role, impacto, controles, validade e plano de revogação. Este prompt não é aceite TEMP.

## Falhas intermediárias e recuperação

- Antes de qualquer mutação: destino/host/TLS falhou → encerrar conexão, sem SQL.
- GATE 1 falha/estado desconhecido → parar; não repetir `CREATE ROLE`. Inspecionar somente após autorização e apresentar opções; não remover automaticamente.
- GATE 2 falha → não conceder grants; proprietário decide a recuperação sem revelar senha.
- GATE 3 falha → preservar estado e saída segura; não adicionar grants manuais. Nova inspeção exige autorização.
- GATE 4 falha → não iniciar Marco C; preservar a role e solicitar decisão. Revogação emergencial exige autorização específica, salvo autorização emergencial prévia cobrindo exatamente o evento.
- Nenhum script de emergência/remoção está autorizado pela aprovação de criação. Não usar CASCADE, DROP OWNED, `service_role`, migrations ou SQL improvisado.

## Revogação e encerramento

Emergencial: arquivo 03, autorização independente; valida marcador, bloqueia novos logins, expira, revoga apenas grants nomeados e encerra sessões autenticadas pela role. Se encerrar sessão falhar, manter NOLOGIN e parar. Definitiva: arquivo 04, autorização independente; verifica sessões/dependências e usa DROP ROLE sem CASCADE; dependências causam abort. Depois, confirmar ausência da role e limpar segredo no gestor local. Não revogar PUBLIC nem alterar outras roles.

## Escopo excluído

Este procedimento não autoriza Marco C, leitura de inventários de negócio, migrações, Storage/Auth/Edge Functions/Vercel, alterações em RLS/grants não listados, deploy, OAuth/publicação TikTok, worker remoto ou pagamentos. A auditoria Cloud e sua conclusão não equivalem a homologação ou liberação para usuários reais.


### Atualização Gate 3.1

Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql`: **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash candidato `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`, sujeito a revisão/aprovação específica. A validação agora falha antes de grants diante de privilégios inesperados; o harness local comprovou bloqueios para ACLs diretas/PUBLIC, membership, ownership, sequences, funções, default ACLs, large objects e falha transacional. Sem autorização/conexão Cloud.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
