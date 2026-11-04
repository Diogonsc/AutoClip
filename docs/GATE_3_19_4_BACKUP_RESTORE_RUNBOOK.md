# Gate 3.19.4 — Runbook de restauração integral em Supabase descartável

Este é um procedimento de **ensaio futuro**. Não foi executado neste gate. Não usar o projeto Supabase Production `djrwfvcxgpyknmizqumn`, nem a stack Supabase local persistente. O alvo deve ser novo, isolado, identificado por ref própria e aprovado pelo proprietário.

## Estado da evidência

O proprietário informa que há backup PostgreSQL e cópia dos objetos Storage com SHA-256 validado. Os caminhos e os bytes desses artefatos não foram reabertos nesta execução. Tentativas anteriores de restore lógico falharam: primeiro por `pg_cron`/`cron.database_name`; depois por `pg_restore --clean` tentando remover constraint herdada de Realtime. Isso **não** valida recuperação. Nunca repetir com `--clean`.

## Decisão do método

1. A cópia física “Restore to a New Project” só é opção se o plano/backup forem compatíveis e o proprietário aceitar o custo. O restore binário pode copiar `pg_cron`, `pg_net` e wrappers; Supabase informa que jobs podem começar logo que a restauração termina, sem uma etapa anterior para pausá-los. Também não copia Storage bytes/configuração. Não usar esse caminho sem demonstrar isolamento de efeitos externos antes do restore. [Supabase: Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
2. Para os artefatos manuais atuais, preferir **restore lógico** em novo projeto Supabase compatível com PostgreSQL 17, usando método documentado e plano revisado de objetos gerenciados. A restauração manual requer tratar funções/extensões, histórico de migrations e customizações em `auth`/`storage`; não despejar um arquivo custom indiscriminadamente em um projeto com objetos Supabase preexistentes. [Supabase: Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
3. Se a análise do TOC indicar que o arquivo existente não pode ser restaurado integralmente com segurança em projeto Supabase novo, **parar**. Não reclassificar restore parcial como completo. Obter aprovação para gerar/exportar artefatos lógicos no formato recomendado ou um método de recuperação compatível.

## Pré-condições

- Aprovação humana específica para copiar dados de Production para ambiente descartável, inclusive dados pessoais e credenciais OAuth cifradas presentes no banco.
- Projeto Supabase descartável separado, região e versão compatíveis, não ligado à Vercel Production, sem callbacks/segredos TikTok e sem billing ativo.
- Controle de saída de rede suficiente para impedir cron/webhook/`pg_net` de contatar serviços reais. Se não for demonstrável antes de qualquer job executar, NO-GO.
- Caminho de backup e manifesto acessíveis em armazenamento criptografado aprovado; permissões do operador mínimas.
- Ferramentas `pg_restore`/`psql` compatíveis com PostgreSQL 17; versão registrada. CLI Supabase e armazenamento do alvo em diretório de trabalho temporário separado.
- Plano para a chave de criptografia da aplicação: não copiar para chat, repo ou snapshot; não configurar chave de Production no clone. Sem ela, ciphertext de token continua opaco e nenhum teste OAuth real é executado.

## Procedimento reproduzível

### A. Congelar identidade do alvo e validar artefatos

1. Em terminal protegido, registrar refs de origem/alvo em ficha privada. Confirmar visualmente que o alvo é descartável e que ref/host não são `djrwfvcxgpyknmizqumn`; confirmar que não é localhost da stack persistente.
2. Usar um diretório novo fora do repositório e com `umask 077`. Não copiar dump ou objetos para o repo.
3. Verificar o manifesto existente (`sha256sum --check <manifesto-aprovado>`). Abrir somente a lista TOC do custom dump (`pg_restore --list <arquivo.dump>`), sem exportar linhas de dados. Registrar a versão PostgreSQL, formato, schemas/extension owners e tabelas/objetos gerenciados que colidem com o alvo.
4. Revisar a lista TOC e preparar uma allowlist assinada/revisada para o alvo novo. **Não** aplicar `--clean`, `--if-exists`, ou remover objetos do alvo. Não executar um restore integral até explicar cada item gerenciado que será incluído/excluído e como será restaurado pelo mecanismo suportado.
5. Se o artefato não tiver formato/escopo confirmado ou não houver método para preservar o conjunto completo de dados+schema sem conflito com objetos gerenciados, parar e registrar restore como não validado.

### B. Preparar Supabase descartável

1. Criar/selecionar novo projeto Supabase separado (operação futura exige autorização; pode haver custo). Confirmar ref, host, versão, região e titularidade no Dashboard.
2. Bloquear uso funcional: não conectar frontend, Edge Functions, workers, TikTok, e-mail, webhooks ou billing. Não copiar configurações de Production que iniciem tráfego.
3. Revisar `pg_cron`, triggers e integrações de saída no clone. Não importar jobs ativos sem desativação segura; o target deve continuar isolado de rede externa durante toda a prova.
4. Nunca apontar a CLI para o worktree/stack local persistente. Usar `--workdir` para cópia temporária de configuração aprovada e confirmar `supabase status`/projeto alvo antes de qualquer operação.

### C. Restaurar PostgreSQL

Usar apenas depois de aprovar a allowlist e confirmar a conexão com o alvo por um segredo/serviço protegido, sem colocar URL com senha na linha de comando ou history. Exemplo de forma (placeholders; não executar sem revisão do TOC):

```sh
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --use-list="$RESTORE_WORKDIR/reviewed-restore.toc" \
  --dbname='service=autoclip_disposable_restore' \
  "$BACKUP_DIR/postgres.dump"
```

`service=autoclip_disposable_restore` deve vir de `pg_service.conf`/credencial gerida fora do repositório, com TLS `verify-full`; não imprimir o arquivo ou URL. Se houver erro, parar. Não repetir com `--clean`, não tentar “consertar” conflitos apagando objetos gerenciados.

Para um restore pelo fluxo lógico oficial Supabase, seguir os artefatos `roles.sql`, `schema.sql` e `data.sql` documentados pelo fornecedor, em alvo novo; usar uma única transação e `ON_ERROR_STOP`; somente aplicar `session_replication_role=replica` conforme orientação oficial e após revisão. A restauração manual não copia automaticamente encryption root key e customizações de `auth`/`storage` podem exigir aplicação separada. Não inserir registros em `storage.objects` por SQL.

### D. Restaurar Storage

1. Criar bucket privado no projeto descartável por Storage API/CLI, com limites/MIME compatíveis e sem tornar bucket público.
2. Usar uma cópia temporária do `supabase/config.toml` em `$SUPABASE_WORKDIR` fora do repo; manter a autenticação CLI em secret storage já configurado. No terminal futuro, com refs verificadas e após autorização:

   ```sh
   umask 077
   mkdir -m 700 -p "$BACKUP_DIR/storage"
   supabase --workdir "$SUPABASE_WORKDIR" link --project-ref "$SOURCE_PROJECT_REF"
   supabase --workdir "$SUPABASE_WORKDIR" storage cp --recursive --experimental --linked \
     ss:///media "$BACKUP_DIR/storage/media"
   ```

   Para restaurar, revalidar primeiro a identidade do alvo e trocar o vínculo **somente no workdir temporário**:

   ```sh
   supabase --workdir "$SUPABASE_WORKDIR" link --project-ref "$DISPOSABLE_PROJECT_REF"
   supabase --workdir "$SUPABASE_WORKDIR" storage cp --recursive --experimental --linked \
     "$BACKUP_DIR/storage/media" ss:///media
   ```

   CLI local v2.117.0 mostra `--linked`/`--local`, não `--remote`; a documentação atual mostra os mesmos modos de cópia. Confirmar a sintaxe da versão instalada antes da janela. Usar uma única finalidade de cada vez (fonte→disco ou disco→destino); jamais usar `mv`/`rm`. Supabase documenta `storage cp` para cópia de objetos: [CLI storage cp](https://supabase.com/docs/reference/cli/supabase-storage-cp).
3. Reaplicar apenas metadados suportados pelo Storage API. Não inserir diretamente em tabelas gerenciadas do Storage.
4. Comparar quantidade, total de bytes e SHA-256 de cada objeto contra o manifesto original. Não expor nomes de objeto nem IDs de workspace em logs compartilhados.

### E. Critérios de aceitação integral

- `pg_restore`/restore lógico termina sem erro, sem objetos omitidos não justificados e sem executar cron/webhook externo.
- Migration ledger, schemas de aplicação, RPC identity arguments, grants, RLS, triggers customizados e extensões esperadas conferidos por consultas de metadados somente leitura.
- Contagens agregadas (sem linhas pessoais) de entidades/jobs/estados relevantes iguais às do manifesto de backup, considerando o timestamp do snapshot.
- Bucket(s) com privacidade/configuração correta; contagem, bytes e cada hash dos objetos iguais ao manifesto.
- Smoke test apenas com fixture sintética e nenhuma publicação/renovação TikTok real.
- Horários, duração, erros, ref do alvo, hash dos artefatos e operador registrados em evidência restrita; RPO/RTO só são declarados se medidos.

Falha em qualquer item = **restore não aprovado**. Recriar outro alvo descartável depois de entender o erro; jamais usar banco local persistente ou Production como alvo.

## Limitações oficiais relevantes

O método “Restore to a New Project” é cópia binária de banco e pode iniciar jobs das extensões imediatamente; esse recurso não copia objetos nem configuração do Storage. A restauração manual por CLI exige tratamento separado para histórico de migrations e customizações em `auth`/`storage`. Referências oficiais: [restore para novo projeto](https://supabase.com/docs/guides/platform/clone-project), [backup/restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [cópia de objetos Storage](https://supabase.com/docs/reference/cli/supabase-storage-cp).
