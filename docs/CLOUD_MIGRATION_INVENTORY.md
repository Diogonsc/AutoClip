# Inventário de migrations Cloud

Estado desta auditoria: **Cloud não conectada; ledger remoto não verificado.** Projeto provável identificado nas fontes locais como `Autoclip` (ref `djrwfvcxgpyknmizqumn`), mas produção versus staging não está declarado. Não há credencial PostgreSQL read-only disponível.

O repositório possui 29 arquivos SQL de migration, em ordem cronológica e sem versões duplicadas. `supabase migration list --local` conectou-se ao banco local e mostrou as mesmas 29 versões no ledger local. A coluna `remote` emitida pelo CLI nesse comando não é evidência do banco Cloud: a própria saída disse “Connecting to local database”.

## Comparação

| Métrica | Resultado |
|---|---|
| Arquivos locais | 29 |
| Ledger Supabase local | 29 |
| Local sem registro no ledger local | 0 |
| Ledger local sem arquivo | 0 |
| Ledger remoto | Não consultado |
| Migrations somente remotas | Não verificável |
| Divergência local/Cloud | Não verificável |

Inventário por nomes/versões está em [PHASE_3_6_2_CLOUD_READ_ONLY_AUDIT.md](PHASE_3_6_2_CLOUD_READ_ONLY_AUDIT.md). Nenhuma migration foi reparada, aplicada ou alterada remotamente.

## Processo futuro

Após autorização explícita: obter alvo exato, executar preflight com identidade read-only, coletar ledger remoto e comparar por version + nome/conteúdo local quando o hash puder ser obtido de forma confiável. Arquivo presente não significa aplicação; tabela semelhante não prova migration aplicada. Não usar `db push`, `db pull` ou `migration repair` como ferramenta de auditoria. Uma divergência requer revisão humana, backup e plano de forward-fix; não reparar ledger automaticamente.
