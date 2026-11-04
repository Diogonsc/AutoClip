# Gate 3.19.4 — checklist operacional de Staging e Production

Checklist de execução futura. Cada escrita remota exige autorização específica; **este documento não autoriza execução**.

## Antes de pedir autorização para Staging

- [ ] Projeto Supabase descartável com ref/host/região/versão documentados; confirmar que não é `djrwfvcxgpyknmizqumn`, não é local dev persistente e não tem link com Vercel Production.
- [ ] Hash e custódia dos artefatos PostgreSQL e Storage conferidos no local protegido.
- [ ] Restore PostgreSQL + objetos Storage concluído de ponta a ponta em projeto/stack descartável; comparar schemas, ledger, RLS/RPC, bucket privado, contagens agregadas e todos os hashes. Restore anterior falhou; não marcar como aprovado até novo sucesso.
- [ ] Saída de rede externa, cron, `pg_net`, webhooks, e-mail, TikTok e billing contidos antes de restaurar ou iniciar o clone.
- [ ] Inventário remoto read-only de Edge Functions/worker/schedules concluído; queries em `GATE_3_19_4_READ_ONLY_AUDIT.sql` revisadas e executadas com role restrita.
- [ ] Bloqueio TikTok Shop aprovado e testado server-side; rota/UI e worker também não podem iniciar Shop. Se o primeiro release realmente excluir Shop do schema, separar M10/M11 Shop em migration nova revisada e replanejar hashes/ledger; não editar migrations já aplicadas.
- [ ] Migrações M01–M11 re-hashadas e comparadas; staging drift reconciliado. Hash atual de M10/M11 consta em relatório 3.19.4.
- [ ] Plano de manutenção executável e testado: workers/schedulers interrompidos; callbacks e endpoints token-writing em maintenance; chamadas em voo drenadas; nenhuma versão antiga com direct UPDATE.
- [ ] Variáveis exigidas pela versão-alvo verificadas por **nome e presença apenas** em cofre aprovado. Não imprimir valores nem copiar `.env`.
- [ ] Observabilidade, limites de lock/timeout, operador, janela, parada e comunicação aprovados.

## Ordem de execução em Staging

1. **S0 Isolamento:** conferir duas vezes project ref/host. Confirmar estado de Shop desativado, egress contido e nenhum destino Production.
2. **S1 Recuperação:** executar restore integral conforme runbook, validar banco e Storage; se falhar, parar antes de migration.
3. **S2 Baseline read-only:** executar SQL de auditoria e testes sintéticos A/B; salvar somente metadados/contagens sem dados pessoais.
4. **S3 Manutenção:** pausar jobs/workers e invocações de todos os escritores listados, incluindo os callbacks de autorização; esperar drain. Não confiar só em parar a UI.
5. **S4 Migrations M01–M09:** aplicar em ordem por arquivo e subgate, cada uma com hash aprovado, timeout/lock budget e consulta de estado. Parar em qualquer erro ou objeto inesperado.
6. **S5 M10/M11:** manter todos os escritores pausados; executar M10 seguida imediatamente por M11 na mesma janela. Não iniciar nenhum worker entre elas. Confirmar as RPCs/ACLs e contagem agregada de estados.
7. **S6 Edge Functions:** implantar funções explicitamente allowlisted uma a uma. Não usar `supabase functions deploy` sem nome, porque pode incluir todos os diretórios. Manter Shop fora da allowlist até bloqueio testado. Confirmar digest/versão e status de cada função.
8. **S7 Worker de vídeo/publicação:** implantar versão compatível com schema novo; manter publicação TikTok suspensa; validar heartbeat/claim/release só com fixture sintética e secrets exclusivos do ambiente.
9. **S8 Frontend:** publicar Preview/host isolado; validar rotas, autorização, upload sintético, validação de mídia, grupos/batches. Sem TikTok Shop, publicação real, cobrança ou exclusão.
10. **S9 Retomada gradual:** liberar primeiro operações internas sem publicação. Liberar OAuth/refresh Login Kit apenas após verificação M10+M11 e sem logs sensíveis. Smoke tests não devem renovar token real nem enviar vídeo.

## Smoke tests e critérios de stop

- `deno check` nos cinco entrypoints = zero diagnóstico; testes Deno/Bun já listados repetidos no pipeline do release.
- Conexão sintética cria/leitura de OAuth state sem troca de code real; refresh rotation apenas mock/test fixture; OAuth real exige subgate.
- Upload sintético passa pelos estados esperados; SHA/dimensões/mime conferidos; serviço de vídeo reporta heartbeat; falha de attestation permanece fail-closed.
- Nenhum cross-workspace em SELECT/UPDATE/Storage; grants RLS/RPC verificados com identidade A e B.
- Nenhum token em logs, nenhuma função Shop utilizável, nenhuma chamada outbound não aprovada.
- Parar se qualquer writer antigo reaparecer, migration demorar além do orçamento, lock/WAL fugir do ensaio, RPC tiver assinatura/ACL divergente, token virar `REAUTH_REQUIRED` em massa, erro de Storage, diferença nos hashes ou status de deploy não for identificado.

## Produção — somente depois de Staging GO e nova autorização

- [ ] Aprovação jurídica/operacional da janela e aceite de risco; staging homologado e restore comprovado.
- [ ] Backup pré-deploy e hashes/MANIFEST preservados fora do repo.
- [ ] Confirmar projeto/ref de Production por canal independente e verificar SHA/ledger imediatamente antes.
- [ ] Plano de manutenção comunicado e testado; parar/drenar writers antigos antes de M10/M11.
- [ ] Aplicar migrations exatamente com hashes aprovados; M10/M11 consecutivas enquanto todos os writers seguem parados.
- [ ] Implantar Edge Functions individualmente pela allowlist, depois worker e frontend conforme compatibilidade aprovada; nunca `--prune`/deploy-all sem análise.
- [ ] Confirmar nenhuma função/rota Shop ativa; não publicar Privacy Policy Draft.
- [ ] Smoke tests somente read-only/sintéticos; não publicar conteúdo TikTok, não cobrar, não apagar mídia.
- [ ] Monitorar erro, queue/lease, status de auth, Storage e logs redigidos; retomar serviços apenas por decisão GO do checkpoint.

## Recuperação

- Pausar serviços e manter maintenance se houver erro. Não tentar migration repetida sem ledger/schema read-only.
- Depois de M10/M11, preferir roll-forward e reconexão conservadora; restaurar refresh tokens antigos pode ser inválido porque o TikTok pode ter invalidado o anterior.
- Restore em Production não é rollback automático: requer aprovação separada, decisão sobre dados gravados após o snapshot e prova de isolamento do processo.
- Recovery aprovado só após DB + Storage e hash de página/artefatos conferidos. Não declarar restore validado com sucesso de `pg_restore` isolado.
