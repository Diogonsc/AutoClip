# Runbook — preparação Cloud metadata-only (não autorizado para executar)

Target lógico: `djrwfvcxgpyknmizqumn`; nenhum contato Cloud foi realizado. Este documento é sequência operacional futura, não permissão.

## B1 — aprovações e preflight

Obter aprovação explícita para Project Ref, operador, janela, arquivo/hash, ação, método de autenticação, risco TEMP e parada/rollback. Recalcular hashes imediatamente antes. Confirmar endpoint oficial direto `db.djrwfvcxgpyknmizqumn.supabase.co:5432`, database `postgres`, usuário esperado e TLS certificado+hostname verify-full; rejeitar poolers. Verificar identidade pelo método oficial e `pg_stat_ssl.ssl=true`. Guard SQL, variável Project Ref e DNS isoladamente não comprovam alvo.

## B2 — criação, grants e verificação separadas

1. Executar apenas `_guard.psql` incluído por `00_create_role.sql`, autorizado por hash; fornecer `audit_local_test=false`, `cloud_admin_approved=true`, Project Ref, `audit_database=postgres`, role e expiração por variáveis psql. O guard compara também `current_database()` com `postgres`.
2. Definir segredo forte com psql interativo após autorização específica; nunca em argv, SQL, shell history ou logs.
3. Executar `01_grant_minimum_permissions.sql` somente após aprovação do grant exato.
4. Executar `02_verify_metadata_readonly.sql`. Qualquer falha ou resultado parcial encerra fluxo.
5. Parar. Marco C exige aprovação separada.

Não executar diretórios inteiros nem scripts históricos. Não executar `inventory_summary`, SECURITY DEFINER, `04_negative_security_tests`, migrations, inventário de Storage/Auth/Vercel ou scripts de publicação.

## Destino/credencial

Usar URL fornecida por secret manager local sem imprimir. Ferramenta rejeita host/db/user/ref diferente, parâmetros, exige TLS verify-full e escreve passfile temporário 0600 em diretório 0700. Não reutilizar credenciais administrativas ou `service_role`. Limitação: morte abrupta pode deixar arquivo temporário, identificável pelo prefixo da ferramenta; inspecionar/limpar sem revelar conteúdo.

## Stop / NO-GO

Parar para hash divergente, alvo incerto, role já existente, autenticação inesperada, TLS inválido, grant inesperado, membership/ownership, permissão de escrita/leitura de negócio, função executável customizada, TEMP não exclusivamente PUBLIC, expiração inválida, timeout ou saída parcial. Nunca elevar credencial para contornar erro.

## Revogação (ação futura com aprovação independente)

- Emergência: `03_emergency_revoke_metadata_role.sql`; confere marcador, NOLOGIN/expiração, revoga somente CONNECT/USAGE/SELECT(version) diretos, então termina sessões de `usename` da role. Não usa application_name, pois é falsificável. Se falhar terminar, manter NOLOGIN e investigar.
- Remoção definitiva: `04_remove_metadata_role.sql`, após emergência, valida dependências e executa DROP ROLE sem CASCADE. Falha se houver dependência; não usar DROP OWNED/CASCADE. Cada uma tem hash e autorização própria.
- Limpeza local: revogar segredo no gerenciador e inspecionar apenas o prefixo conhecido de passfile temporário.

## Hashes

| Arquivo | SHA-256 |
|---|---|
| `scripts/cloud-audit/sql/_guard.psql` | `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` |
| `scripts/cloud-audit/sql/metadata-only/00_create_role.sql` | `74a7a95cb411b93942df6e386358f25f8e157e979fd6e0600bd48586063adbf4` |
| `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` | `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` |
| `scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql` | `49d6d2d6a7550f111fa44e762a7474a16dce3071975a65a6c90829c4e53d5637` |
| `scripts/cloud-audit/sql/metadata-only/03_emergency_revoke_metadata_role.sql` | `ef6a8e0365caafa657fc0e5ccbdc8ee4d250bb6ec92e2220ab5ef2f1c519ac17` |
| `scripts/cloud-audit/sql/metadata-only/04_remove_metadata_role.sql` | `08da9cff7023f71b3a9205482a4091f0b45dd57f7472729100fece673f1af4bf` |

SQL byte-exato em `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`; hash alterado invalida aprovação. Scripts 03/04 são revogação/remoção separadas.

## Evidência local

`node --test scripts/cloud-audit/readonly-audit.test.mjs` e `node scripts/cloud-audit/test-readonly-role-local.mjs` devem ser reexecutados antes de qualquer autorização Cloud. Testes locais não conferem cloud state.

## Marco B.2-A — handoff e autorização pendente

Antes de qualquer execução, o proprietário deve preencher e aprovar operador, ferramenta/host, método oficial de autenticação, host/porta copiados do dashboard oficial, database `postgres`, janela/fuso e aceitação expressa do risco TEMP. Aprovar os hashes por ação, individualmente: `_guard.psql` + `00_create_role.sql`; definir senha interativamente em ação separada; `01_grant_minimum_permissions.sql`; `02_verify_metadata_readonly.sql`. Não executar a pasta como um todo.

### Sequência autorizável B.2-B (não executar neste Marco)

1. **Validar destino.** Pré-condição: autorização identificando Project Ref, operador e host oficial. Confirmar conexão direta, porta confirmada, database `postgres`, usuário administrativo esperado, certificado/hostname TLS (`verify-full`), `current_database()`, `current_user` e `pg_stat_ssl.ssl=true`. Rejeitar pooler, host arbitrário, redirect, parâmetro de URL que reduza TLS ou identidade ambígua. Evidência: host e identidade sem imprimir segredo. Falha: interromper sem SQL.
2. **Criar role.** Pré-condição: role ausente e hash aprovado. Executar apenas o arquivo exato `00_create_role.sql` com guard e variáveis aprovadas. Esperado: role marcada, não privilegiada, expiração <=14 dias e defaults configurados. Falha ou saída parcial: parar; não tentar corrigir por SQL improvisado.
3. **Definir segredo.** Exige autorização própria. Com psql interativo, usar `\\password autoclip_cloud_auditor`; não inserir senha em argv, URL, SQL, histórico ou log. Armazenar em secret manager local aprovado. Falha: não conceder grants.
4. **Conceder mínimos.** Pré-condição: inspeção pós-criação sem divergência e hash aprovado. Executar somente `01_grant_minimum_permissions.sql`. Esperado: CONNECT e, se ledger compatível sem RLS, USAGE + SELECT(version). Não mudar PUBLIC. Falha: parar e não iniciar auditoria.
5. **Verificar.** Executar somente `02_verify_metadata_readonly.sql`. Saída incompleta, timeout ou qualquer condição insegura = NO-GO. Parar após verificação; Marco C não começa automaticamente.
6. **Revogar/remover.** Scripts 03 (emergência) e 04 (remoção sem CASCADE) requerem autorização separada cada. Se terminar sessão falhar, manter NOLOGIN e investigar; não ampliar poderes nem usar `application_name` como identidade.

Todos os parâmetros administrativos não confirmados permanecem **PENDENTE**. O Project Ref esperado e o guard não autenticam o endpoint. Risco TEMP via PUBLIC permanece ALTO e precisa de aceite explícito.

Para o handoff de gates 0–4 do Marco B.2-B, consulte `CLOUD_B2B_EXECUTION_AUTHORIZATION.md`. Client local observado: `psql 18.6`; servidor Supabase local de teste: PostgreSQL 17.6. Isso não confirma a compatibilidade TLS Cloud. Host, porta, usuário, CA, TLS, método de autenticação, operador efetivo e janela seguem pendentes. Não executar antes de confirmação oficial e aprovação por gate.

## Limites de verificação

A revisão dos SQLs é local e não comprova privilégios reais do Supabase Cloud. `02_verify_metadata_readonly.sql` precisa retornar todas as verificações aprovadas; erro psql é bloqueio. O ledger só é concedido/lido com RLS e FORCE RLS desligados. A role marker é barreira contra erro operacional, não prova criptográfica de origem. A revogação usa `usename` autenticado; application_name é forjável e não é identidade.


### Gate 3.1 — precheck local atualizado

O hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash candidato atual: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; sem autorização Cloud. O script usa checagem serializável de privilégios efetivos antes de GRANT e falha fechada. Bancos internos `postgres`, `_supabase`, `storage_vectors` e `template1` são exceção apenas em `audit_local_test=true`, somente para CONNECT/TEMP herdados sem grants diretos, CREATE ou GRANT OPTION; qualquer acesso a banco fora do alvo bloqueia em Cloud. O estado ACL remoto ainda é desconhecido.


Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
