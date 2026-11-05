# Auditoria PostgreSQL read-only por componente

Este pacote prepara uma inspeção manual futura dos metadados PostgreSQL do projeto `djrwfvcxgpyknmizqumn`. **Não foi executado no Cloud neste Gate.** A role `autoclip_cloud_auditor` está NOLOGIN segundo diagnóstico histórico e não deve ser utilizada. A execução futura exige aprovação explícita e sessão administrativa dedicada.

## Execução preparada

Na raiz deste repositório, o operador autorizado poderá chamar `bash scripts/cloud-audit/component-readonly/run-component-audit.sh <componente>`. O wrapper permite apenas `preflight`, `schema`, `rls`, `grants`, `routines`, `storage`, `extensions`, `jobs` e `ledger`; um componente por chamada. Antes da conexão confere os hashes fixos, CA/fingerprint, host Direct e TLS `verify-full`, solicita senha interativamente, neutraliza variáveis PostgreSQL de conexão, define `PGPASSFILE=/dev/null` e grava JSON local com modo restrito. Não há retry. A credencial não é armazenada.

O SQL contém consultas fixas em transações `READ ONLY`, timeouts e guard irmão `_guard.psql`. O guard valida a identidade declarada da sessão; não consegue provar sozinho a cadeia TLS/hostname nem que o host pertence ao projeto. Essa prova cabe ao conninfo fixado, CA oficial e TLS verificado no wrapper e à confirmação independente do operador.

## Escopo e limites

- Catálogos: inventário estrutural, RLS, ACLs/memberships, propriedades de rotinas, extensões, forma de catálogos de jobs e versão do ledger quando a forma for compatível.
- Storage: somente configuração de buckets; não consulta `storage.objects` nem baixa arquivos.
- Jobs/pg_cron/pg_net: somente forma/metadata de catálogos; sem linhas de jobs, comandos, filas, chamadas HTTP ou execução de funções.
- Funções: propriedades e ACLs, sem corpo de função. Auth, Edge Functions, secrets, TikTok e Vercel requerem canais oficiais separados e permanecem não verificados por PostgreSQL.
- `NOT_VERIFIED`, erro, saída incompleta ou metadados invisíveis não significam que não há objetos ou riscos.

Os relatórios podem revelar nomes internos e propriedades de segurança. Mantê-los fora do repositório, com permissões restritas, sanitizar antes de compartilhar e apagar conforme retenção aprovada. Não incluir tokens, PII ou conteúdo de aplicação.

## Testes locais

`node --test scripts/cloud-audit/component-readonly/component-readonly.test.mjs` verifica escopo/estrutura. `node scripts/cloud-audit/component-readonly/test-component-readonly-local.mjs` cria um banco descartável no container Supabase local `tiktok-saas`, testa as consultas contra fixtures e remove o banco ao final. O harness não conecta ao Cloud. O teste de guarda inclui rejeição explícita de um alvo local em modo Cloud; resultados locais não provam privilégios, deploy ou visibilidade no Supabase Cloud.

O diretório contém **nove** scripts SQL: os oito componentes da sequência originalmente proposta e `08_migration_ledger.sql`, que foi separado para a reconciliação do ledger. A ordem permitida pelo wrapper é `preflight`, `schema`, `rls`, `grants`, `routines`, `storage`, `extensions`, `jobs`, `ledger`; cada componente deve ser autorizado e executado separadamente. O resultado SQL é um objeto JSON por relatório. O wrapper não acrescenta um manifesto assinado nem timestamp do servidor: o horário do arquivo é apenas metadado local, e o operador deve registrar separadamente o horário local, o hash aprovado, o componente e o resultado de cada execução. A execução não produz prova criptográfica da identidade de quem iniciou o comando.

## SHA-256 do pacote preparado

Hashes recalculados localmente em 02/11/2026. O wrapper fixa os hashes do guard e dos SQLs; o teste estático falha se algum pin não corresponder ao conteúdo atual.

| Arquivo | SHA-256 |
|---|---|
| `_guard.psql` | `3702f145a33ffcb3d16138246b9aec0daf3bd564086e34039859338db66052b1` |
| `00_environment_preflight.sql` | `7f31204f14829d66e576dcc06cf28c955ed37ed19c34975a981c450bec90561e` |
| `01_schema_inventory.sql` | `ad5064b58e34214004ef758b7182442f0bbbd8dd0a5654f751042954c2c5223c` |
| `02_rls_policies.sql` | `1ce0c0445db943a9156efa91b7b79f9cca9e7c426533c566262834401053609a` |
| `03_roles_grants_public.sql` | `d393c7ce849db68d7ba571a12b770433004c86faa604b385c1323bf08d67ec17` |
| `04_security_definer_functions.sql` | `efad352064cdd5256accb649a6b3b1bc00dbe256cfbafc4c54bedee7095cf1b9` |
| `05_storage_metadata.sql` | `dfce37f7f3c0303cb49f4465b32cded6891d750789d952602a6a0868299f5bc1` |
| `06_extensions_pg_net.sql` | `21e4c3555c28caae6521c91354acfaf64633473647727cfad782f5a7c62815fb` |
| `07_jobs_metadata.sql` | `6b91012c752cd8bcdd250e7ddb22388bbd8c171d088330889f6f02c10aa726df` |
| `08_migration_ledger.sql` | `a58508f7612def71af5ad8c9a691c6e0c890b127b6315fa92672075a5752218c` |
| `run-component-audit.sh` | `0bc58b20b9364799ec37faaf1b20920d1d192daaa910f93eaff0d6baccc9db32` |

Gate 3.13 local review added explicit privilege checks before reading bucket configuration and ledger `version`. If the operator cannot read those objects, the query returns `NOT_VERIFIED` rather than failing while reading rows. The prior hashes for the two changed SQL files are superseded; these new hashes are candidates for review and do not constitute Cloud execution approval.

Não usar `supabase db push`, `db pull`, `db reset`, migrations, a role temporária, SQL arbitrário ou outro usuário como fallback. Qualquer mudança encontrada requer gate e aprovação próprios.
