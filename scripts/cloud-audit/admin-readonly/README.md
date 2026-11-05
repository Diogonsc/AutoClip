# Supabase Cloud — pacote administrativo read-only e contenção

**Atualização Gate 3.11:** o proprietário informou ter executado `31_disable_role_nologin.sql`; o diagnóstico independente local `/home/diogo-nascimento/autoclip-admin-readonly.oMuxIr` confirma a role presente com `can_login=false`, zero sessões e zero dependências compartilhadas. O relatório bruto permanece local em modo `0600`. A role não foi removida, grants não foram revogados e `TEMP` continua true por privilégio efetivo.

As notas de preparação abaixo preservam o histórico. Não reexecute `contain` com o relatório atual: o modo `validate` exige LOGIN ativo e deve bloquear uma role já contida. Qualquer nova alteração administrativa exige diagnóstico atual e autorização própria.

## Arquivos

- `00_role_containment_diagnostic.sql`: somente leitura; estado da role, validade, memberships em ambas as direções, dependências compartilhadas, grants/dependências registrados pelo catálogo e sessões sem texto de consulta nem IP.
- `10_catalog_inventory.sql`: somente leitura; catálogos de schemas, objetos, colunas, ACLs, constraints, índices, triggers, RLS/policies, propriedades de rotinas, memberships, dependências de extensões e metadados estruturais de `cron`, `net` e `storage`. Lê apenas `version` do ledger quando o objeto é tabela compatível e RLS/FORCE RLS estão desligados.
- `20_removal_preflight.sql`: somente leitura; pré-condições para remoção definitiva sem `CASCADE`, incluindo membership em ambas as direções e dependências.
- `30_disable_role_and_terminate_sessions.sql`: **mutável** e não autorizado. Somente altera `autoclip_cloud_auditor` para `NOLOGIN`/expiração e tenta encerrar sessões autenticadas com esse `usename`; não altera grants, PUBLIC ou outras roles. O commit da desativação precede a terminação, então falha na segunda etapa deixa contenção parcial e requer investigação.
- `31_disable_role_nologin.sql`: proposta local separada para desativar novos logins apenas. Requer a identidade/marcador e estado observados no Gate 3.9, a membership esperada de `postgres`, ausência de outras memberships/dependências/sessões, e confirma NOLOGIN após commit. É mutável e **não autorizada**; não termina sessões nem altera validade, grants, PUBLIC ou outras roles.

## Consulta de catálogo versus dados operacionais

O pacote usa `pg_catalog` e funções de inspeção/desformatação PostgreSQL. `10_catalog_inventory.sql` também lê somente os valores `version` do ledger de migrations, se a verificação de forma permitir. Ele não lê linhas de jobs, fila, respostas HTTP, buckets, objetos Storage ou dados de workspace. Para `cron`, `net` e `storage`, retorna nomes/estrutura, RLS/policies e ACLs do catálogo, sem executar rotinas da aplicação ou da extensão.

Metadados de linhas de `cron.job`, filas pg_net, `storage.buckets`, `storage.objects`, jobs AutoClip, quotas, reservas e agendamentos exigem uma consulta operacional separada. Eles ficam fora deste pacote e não devem ser adicionados sem escopo e autorização próprios. Nenhum arquivo, conteúdo binário, URL assinada, token ou dado pessoal é consultado.

As definições de constraints, índices, triggers e expressões de policies podem revelar detalhes internos de implementação. Armazene a saída em arquivo local `0600`, revise antes de compartilhar e reduza/mascare nomes se distribuir o relatório.

## Guard e execução futura

`00_role_containment_diagnostic.sql` inclui o guard irmão `scripts/cloud-audit/admin-readonly/_guard.psql` (SHA-256 `9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f`). Ele **não** inclui o guard legado `scripts/cloud-audit/sql/_guard.psql` (SHA-256 `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347`); os dois arquivos e seus escopos são distintos.

O guard administrativo exige `cloud_admin_approved=true`, Project Ref exato, database e role esperados, sessão `postgres`, database efetivo correto, `application_name` fixo e TLS ativo observado em `pg_stat_ssl`. Em falha, `SELECT 1/0` combinado com `ON_ERROR_STOP` garante encerramento não zero; o `psql` testado ignora argumento numérico em `\quit`. A ramificação de teste local exige database descartável, socket Unix e `supabase_admin`; ela não substitui o guard Cloud. `sslmode=verify-full` e o CA oficial devem ser passados pelo cliente libpq; o SQL confirma criptografia ativa, mas não pode provar sozinho que o cliente validou cadeia e hostname. Nenhuma consulta obtém IP ou tenta inferir o Project Ref.

O arquivo CA local foi observado como PEM `Supabase Root 2021 CA`, serial `6CBC4CA1DEB63F692D0A2024C67289C2D13D54F6`, válido até 2031-04-26, fingerprint SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. O modo confirmado agora é `0644`, sem escrita por grupo ou outros usuários. O arquivo é idêntico byte a byte à cópia local fornecida pelo proprietário; a origem no painel oficial é a informação do proprietário.

Exemplo **NÃO EXECUTAR sem nova autorização específica** a partir da raiz do repositório:

```bash
set -eu
umask 077
out="$(mktemp "${HOME}/autoclip-admin-readonly.XXXXXX")"
keep_report=0
cleanup() {
  rc=$?
  trap - EXIT
  if [ "$keep_report" -ne 1 ] && [ -n "$out" ]; then
    rm -f -- "$out" || printf 'Warning: could not remove partial report: %s\n' "$out" >&2
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 600 "$out"
if env \
  -u PGSERVICE -u PGSERVICEFILE -u PGPASSWORD -u PGHOST -u PGHOSTADDR \
  -u PGPORT -u PGDATABASE -u PGUSER -u PGSSLMODE -u PGSSLROOTCERT \
  -u PGSSLCRL -u PGSSLCRLDIR -u PGSSLCERT -u PGSSLKEY -u PGAPPNAME \
  -u PGCONNECT_TIMEOUT -u PGOPTIONS -u PGTARGETSESSIONATTRS \
  PGPASSFILE=/dev/null \
  psql -X -W -q -A -t \
    -v ON_ERROR_STOP=1 -v audit_local_test=false \
    -v cloud_admin_approved=true \
    -v cloud_project_ref=djrwfvcxgpyknmizqumn \
    -v audit_database=postgres -v audit_role=autoclip_cloud_auditor \
    -f scripts/cloud-audit/admin-readonly/00_role_containment_diagnostic.sql \
    -o "$out" \
    'host=db.djrwfvcxgpyknmizqumn.supabase.co port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=/home/diogo-nascimento/Documentos/Atual/AutoClip/prod-ca-2021.crt connect_timeout=10 application_name=autoclip_gate36_admin_readonly'
then
  if jq -s -e 'length == 1 and (.[0] | type == "object" and has("role_present") and has("marker_matches") and has("can_login") and has("valid_until") and has("connection_limit") and has("membership_edges") and has("active_session_count") and has("active_sessions") and has("shared_dependencies"))' "$out" >/dev/null; then
    keep_report=1
    printf 'Protected JSON output: %s\n' "$out"
  else
    printf 'Diagnostic output is invalid or incomplete; partial report will be removed.\n' >&2
    exit 1
  fi
else
  rc=$?
  printf 'Diagnostic failed; partial output will be removed (exit %s).\n' "$rc" >&2
  exit "$rc"
fi
```

O comando usa conninfo único, Direct, `verify-full`, CA por caminho absoluto, prompt interativo e `-q -A -t` para suprimir tags de comandos (`BEGIN`, `SET`, `COMMIT`) e gravar apenas o JSON da consulta. Não coloca segredo em argumentos nem em ambiente. O relatório só é preservado após o `psql` concluir com sucesso e o `jq` confirmar exatamente um objeto com os campos requeridos. O `trap EXIT` remove saída parcial; HUP, INT e TERM encerram com status não zero e acionam a limpeza. Nenhuma tentativa é repetida. `-o`, `umask 077` e `chmod 600` protegem o arquivo; não compartilhe sem revisão. Para executar `10_catalog_inventory.sql` ou `20_removal_preflight.sql`, cada um exige autorização e execução separadas. **Não use o comando para `30_disable_role_and_terminate_sessions.sql` sem autorização explícita de contenção.**

Resumo sanitizado após sucesso (substitua pelo caminho impresso; não exibe sessões brutas, PIDs, IPs ou texto de queries):

```bash
jq -s -e 'if length == 1 then .[0] | {
  role_present, role, marker_matches, can_login, valid_until, connection_limit,
  superuser, inherit, create_role, create_db, replication, bypass_rls,
  database_privileges, membership_edges, effective_memberships,
  active_session_count,
  active_session_states: ((.active_sessions // []) | map(.state // "unknown") | group_by(.) | map({state: .[0], count: length})),
  dependency_counts: ([.shared_dependencies[].dependency_type] | group_by(.) | map({type: .[0], count: length}))
} else error("expected exactly one JSON object") end' "$HOME/autoclip-admin-readonly.REPLACE_WITH_SUFFIX"
```

No Gate 3.9, `active_session_count` foi `0`, mas um resumo anterior exibiu `unknown: 1`. A causa foi o fallback `// "unknown"` aplicado a um gerador vazio do jq, que transformava ausência de elementos em um valor. A expressão atual primeiro normaliza a lista (`.active_sessions // []`) e usa `map`; para lista vazia, o resultado é `[]`. O relatório SQL original agrega a lista e a contagem com o mesmo filtro. O resultado fornecido é consistente com zero sessões; a entrada `unknown` do resumo não comprova uma sessão.

## Preparação da contenção NOLOGIN

O script `31_disable_role_nologin.sql` é separado do script legado `30_disable_role_and_terminate_sessions.sql`. O novo arquivo faz uma única alteração possível (`ALTER ROLE autoclip_cloud_auditor NOLOGIN`) dentro da transação após prechecks; depois do commit abre uma transação read-only independente para confirmar o estado persistido. Não executa `pg_terminate_backend`. Se a verificação independente falhar ou a conexão cair depois do commit, NOLOGIN pode já estar aplicado: não repetir; executar diagnóstico read-only autorizado e reconciliar.

As precondições correspondem ao Gate 3.9: marker exato, atributos não administrativos, `CONNECTION LIMIT 1`, validade observada até `2026-11-15 00:43:58+00`, uma única membership conhecida (`postgres` membro da role auditora com ADMIN OPTION e INHERIT/SET false), nenhuma membership em que a role auditora seja membro, nenhuma dependência `pg_shdepend` e nenhuma sessão visível. A ausência de sessões e dependências não prova que a role não conste de configurações externas de serviços; essa verificação não está disponível nos catálogos consultados.

Qualquer divergência bloqueia antes do ALTER. Se houver sessões, não as termina; a contenção fica pendente para decisão e autorização separadas. O script foi testado somente no PostgreSQL local isolado. A execução Cloud posterior foi informada pelo proprietário; o hash corrigido executado foi `335997ae505ebb3d2f58d63ccddb03fcb5488ba18ae94933cbc0fe0278700707`. O Gate 3.10.1 anterior, hash `ca814bf5e968f0212fef1af5c0b61dba765be62579af02e967b953115a404550`, falhou antes do ALTER por SELECT negado em `pg_authid` e está obsoleto.

Se houver falha TLS, host inesperado, autenticação, guard, timeout ou resultado parcial: pare; não troque endpoint, não baixe validação TLS, não repita ação mutável e não use credencial alternativa. Preserve a saída/erro redigidos para revisão. Se a desativação foi commitada mas sessões não terminaram, a role fica NOLOGIN mas sessão já aberta pode permanecer.

## Fluxo operacional Gate 3.10.4 — wrapper Bash

`containment-ops.sh` é um wrapper local para tornar a sequência Bash explícita mesmo quando o shell interativo é Zsh. Execute cada comando a partir da raiz do repositório. O wrapper não faz tentativas automáticas, valida os hashes e o fingerprint do CA e mantém os subcomandos separados:

```bash
bash scripts/cloud-audit/admin-readonly/containment-ops.sh diagnose
```

O diagnóstico consulta somente `00_role_containment_diagnostic.sql` e grava um JSON protegido. Em seguida, valide o caminho recém-impresso:

```bash
bash scripts/cloud-audit/admin-readonly/containment-ops.sh validate "$HOME/autoclip-admin-readonly.SUBSTITUA"
```

`validate` exige arquivo do usuário atual, modo `0600`, idade máxima de cinco minutos e o estado observado esperado antes da contenção. Data de modificação é apenas controle operacional; o SQL NOLOGIN revalida no banco. Se qualquer campo divergir, não execute o próximo comando.

Para produzir o resumo sanitizado de qualquer diagnóstico recente — inclusive o diagnóstico posterior, em que `can_login` esperado é `false` — use:

```bash
bash scripts/cloud-audit/admin-readonly/containment-ops.sh summarize "$HOME/autoclip-admin-readonly.SUBSTITUA"
```

O subcomando abaixo é **mutável**. A execução correspondente foi posteriormente informada como concluída pelo proprietário. Não o execute novamente sem novo diagnóstico, autorização específica, hashes conferidos e verificação de que LOGIN ainda está ativo:

```bash
bash scripts/cloud-audit/admin-readonly/containment-ops.sh contain "$HOME/autoclip-admin-readonly.SUBSTITUA"
```

Ele executa exclusivamente `31_disable_role_nologin.sql`, com prompt interativo da senha administrativa. O resultado textual do wrapper não substitui uma nova execução read-only de `diagnose` e `summarize`. O diagnóstico atual informado confirma `can_login=false`. Se nova verificação encontrar sessão ativa, não a encerre; aguarde autorização separada. A saída protegida da contenção deve ser preservada em falhas ou desconexões para reconciliação. O wrapper não executa o legado `30_disable_role_and_terminate_sessions.sql`.

Para o estado consolidado, evidências e pendências Cloud, consulte [`CLOUD_SECURITY_AUDIT_FINAL_REPORT.md`](../../../docs/CLOUD_SECURITY_AUDIT_FINAL_REPORT.md), [`CLOUD_SECURITY_CLOSURE_CHECKLIST.md`](../../../docs/CLOUD_SECURITY_CLOSURE_CHECKLIST.md) e [`INTEGRATED_HOMOLOGATION_READINESS.md`](../../../docs/INTEGRATED_HOMOLOGATION_READINESS.md). A contenção não libera o piloto.
