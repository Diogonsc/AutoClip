# Gate 3.12 — comparação entre worktree local e Supabase Cloud

## Estado

Esta é uma metodologia de comparação, não um resultado de comparação remota. Nenhuma conexão ou consulta Cloud foi realizada neste Gate. Project Ref esperado: `djrwfvcxgpyknmizqumn`; database `postgres`. A role `autoclip_cloud_auditor` permanece NOLOGIN e não deve ser usada.

O repositório contém 29 migrations SQL no inventário atual. Os 29 arquivos locais não provam quais versões foram aplicadas remotamente. O ledger Cloud e o estado remoto de schemas, funções, policies, grants, Storage, extensões e jobs são **PENDENTES DE VERIFICAÇÃO REMOTA**. Não declarar divergência antes de comparar evidências equivalentes.

## Procedimento futuro

1. Gerar localmente um manifesto ordenado das migrations (nome, versão e SHA-256) e preservar o commit/worktree de referência.
2. Obter aprovação específica para cada componente e identidade de operador. Confirmar Project Ref, host oficial, database, TLS `verify-full`, CA, aplicação cliente e janela. Usar somente o wrapper fixo em `scripts/cloud-audit/component-readonly/run-component-audit.sh`; executar um componente por vez. O wrapper verifica hashes e cria relatório local restrito. Não passar SQL ou nome de arquivo arbitrário.
3. Rever a saída JSON de cada execução e sua validade/escopo antes de comparar. Um erro, saída parcial, chave ausente ou status `NOT_VERIFIED` significa que a seção não foi verificada; não significa ausência do objeto.
4. Comparar `version` do ledger, quando a tabela tiver forma compatível e não estiver protegida por RLS/FORCE RLS, com a lista local. O pacote não lê `auth`, tabelas de negócio, linhas de jobs, comandos cron, conteúdo de Storage ou corpos de funções.
5. Comparar inventários canônicos por schema, objeto, coluna estrutural, constraints, índices, triggers, policies, ACLs e propriedades de rotinas. Normalizar ordenação e tipos antes de comparar; preservar separadamente a evidência original protegida.
6. Classificar cada item como `MATCH`, `DIVERGENT`, `NOT_VERIFIED` ou `NOT_IN_SCOPE`; para `DIVERGENT`, confirmar compatibilidade/versão antes de propor qualquer mudança. Nenhuma migration, pull, push, reset, deploy ou correção automática integra esse procedimento.
7. Submeter resultados e plano de correção em gate separado. Qualquer mutação Cloud exige aprovação explícita por arquivo/hash, backup/rollback e janela próprios.

## Cobertura do pacote read-only

| Área | Fonte local | Fonte Cloud planejada | Limite |
|---|---|---|---|
| Migrations | arquivos SQL e hashes locais | somente coluna `version` do ledger compatível | não prova igualdade do conteúdo aplicado |
| Schemas/objetos | migrations e código | catálogos de schemas, relações, colunas, constraints, índices e triggers | metadados invisíveis ou erro = `NOT_VERIFIED` |
| RLS | policies locais e pgTAP | catálogo de policies e flags RLS/FORCE RLS | não executa testes como usuários Cloud |
| Roles/grants | grants em migrations | flags públicas/roles, memberships, ACLs, defaults e large objects | visibilidade depende do papel de conexão; nenhuma ACL é alterada |
| Funções | definições das migrations | propriedades, ACL, owner e configuração de segurança | pacote não retorna corpos; revisão de código continua local |
| Storage | migrations/policies | configuração de buckets apenas | sem linhas de `storage.objects`, arquivos ou policies por usuário se não visíveis |
| Extensões | migrations/configuração | metadados da extensão e forma de catálogos pg_net | nenhuma chamada HTTP ou leitura de fila |
| Jobs | SQL/código local | forma de catálogos e relações associadas | sem linhas de cron, payloads ou dados operacionais |

Auth, Edge Functions implantadas, secrets, Vercel e configuração de TikTok dependem de interfaces oficiais e autorizações separadas; ficam `NOT VERIFIED` por este pacote PostgreSQL.

## Proibições da comparação

Não executar `supabase db push`, `db reset`, `db pull`, migrations, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, DML, funções da aplicação, rotinas pg_net, jobs ou chamadas de publicação. Não usar credencial administrativa como fallback automático. Guard e wrapper são barreiras operacionais, não prova independente de estado Cloud.

## Atualização Gate 3.13 — relatórios recebidos

O proprietário executou manualmente os nove componentes; os relatórios JSON locais disponíveis foram reconciliados em [relatório Gate 3.13](GATE_3_13_CLOUD_RECONCILIATION_REPORT.md). O ledger observado contém 21 versões: todas coincidem por ID com versões locais; oito versões locais (`20261103000001`–`20261103000008`) não aparecem no ledger. IDs iguais não provam igualdade do conteúdo SQL. O inventário também não observou as tabelas/colunas de grupos, lotes e validação introduzidas pelas oito versões. O bucket observado permanece privado `media`, com MIME de vídeo e sem `media-quarantine`.

RLS, ACLs, rotinas, Storage, extensões e forma de catálogos agora têm evidência observada, com limites no relatório. Não houve leitura de linhas operacionais, corpos de funções, secrets ou objetos Storage, nem teste de autorização runtime. Auth, Edge/Vercel/TikTok, jobs configurados, equivalência de corpos e isolamento end-to-end permanecem `NOT_VERIFIED`. Esta atualização não aprova migrations ou homologação.
