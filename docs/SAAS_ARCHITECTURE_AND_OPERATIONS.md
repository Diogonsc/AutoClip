# AutoClipe — arquitetura SaaS e operação

## Auditoria de base (2026-10-31)

O frontend é uma SPA React/Vite hospedável na Vercel. Ele acessa o Supabase diretamente apenas com a chave pública, com RLS por workspace; operações sensíveis usam Edge Functions. O banco possui workspaces, papéis OWNER/ADMIN/EDITOR/VIEWER, auditoria e políticas para dados e objetos do bucket privado `media`.

O OAuth do TikTok é o fluxo Web oficial (`/v2/auth/authorize/`). O `state` é de uso único, tokens ficam somente no banco, cifrados com AES-256-GCM na Edge Function e vinculados ao identificador do canal. A renovação de token, publicação e consulta de estado acontecem no backend. Não há automação de login, cookies de sessão ou proxies para burlar limites.

As publicações são jobs persistentes. `claim_publication_jobs` usa bloqueio de linha com `SKIP LOCKED`; o worker persiste o `publish_id` antes do upload, usa retentativa e deixa resultado ambíguo como `UNKNOWN`, sem reenviar automaticamente. Vídeo usa upload oficial por arquivo; fotos/carrossel usam `PULL_FROM_URL` por URL temporária no domínio HTTPS verificado quando configurado. TikTok Shop é um pipeline separado e foi preservado.

O upload de mídia é direto do navegador para o Storage privado. O arquivo é validado no cliente, criado como `UPLOADING` e finalizado por RPC apenas se o objeto existir. O limite atual por vídeo é 50 MiB, alinhado ao bucket de desenvolvimento. Biblioteca, filtros, pré-visualização com URL assinada, CSV de agendamento e calendário já existiam.

## Entregas SaaS desta fase

A migration `20261102000001_saas_entitlements_and_media_retention.sql` introduz:

- planos configuráveis no banco (Starter, Pro, Advanced, Agency e Enterprise);
- assinatura por workspace, teste de 7 dias para workspaces novos e camada preparada para `MANUAL`, Stripe e Mercado Pago;
- ciclos de uso, reserva ao confirmar agendamento, conversão para consumo apenas em `PUBLISHED` e liberação em `FAILED`/`CANCELLED`;
- bloqueio transacional de novas conexões TikTok acima do limite do plano;
- histórico de eventos de assinatura e reserva de quota;
- página **Plano e consumo** para simular mudança/cancelamento em desenvolvimento. Ela não cria checkout e não cobra o usuário;
- indicadores de plano, quota e armazenamento no painel;
- configuração de retenção de mídia no workspace.

O downgrade nunca apaga contas, publicações ou mídia. Se o consumo existente exceder um limite novo, ele fica preservado e apenas novas operações ficam bloqueadas até o ciclo seguinte ou uma mudança de plano.

## Retenção e limpeza de mídia

A função `media-cleanup` é interna, protegida pelo mesmo `WORKER_SECRET` do worker de publicação. A decisão de elegibilidade ocorre no banco, nunca no navegador. Para um arquivo ser candidato ele precisa:

1. estar `READY` e pertencer ao mesmo workspace;
2. ter ao menos uma publicação `PUBLISHED` concluída há mais que o período de segurança;
3. não possuir rascunho, agendamento, processamento, retentativa, bloqueio ou resultado desconhecido que o referencie;
4. receber uma trava exclusiva antes da remoção. Novos agendamentos não aceitam mídia travada;
5. ser revalidado ao terminar o processamento.

O worker executa em lotes pequenos. Em dry-run, registra `DRY_RUN` na tabela `media_cleanup_audit` e libera a trava sem apagar o objeto. Em exclusão real, remove primeiro o objeto privado e só então marca a mídia como `DELETED`, com data e motivo. Falhas no Storage são auditadas e deixam a mídia disponível para reconciliação/retry. A tabela de auditoria mantém bytes, motivo e data; não guarda URLs assinadas, tokens ou credenciais.

Valores iniciais seguros por workspace:

| Configuração | Valor |
|---|---:|
| `auto_delete_media_enabled` | `false` |
| `auto_delete_media_dry_run` | `true` |
| `auto_delete_media_grace_hours` | `24` |
| `auto_delete_media_batch_size` | `10` |

O `pg_cron` só chama a função a cada 15 minutos quando ao menos um workspace habilitar a rotina. Portanto, aplicar a migration antes de publicar a Edge Function não causa chamadas remotas enquanto a configuração padrão estiver preservada.

### Homologação de limpeza

1. Aplique a migration em um projeto de homologação e publique `media-cleanup`.
2. Habilite **Executar limpeza automática**, mantendo **Modo de simulação** ligado.
3. Publique um vídeo de teste, aguarde a confirmação e o grace period.
4. Verifique `media_cleanup_audit` como administrador e confirme que não existem jobs ativos para o asset.
5. Só com autorização explícita, desative o dry-run. Nunca faça isso inicialmente em produção.

## Custos e limites de infraestrutura

No plano gratuito, os principais vetores são Storage/egress, banco, invocações e tempo das Edge Functions. O AutoClipe reduz transferência pela Vercel ao fazer upload direto ao Supabase Storage, usa URLs assinadas curtas, processa a fila e limpeza em lotes, pagina listas e evita polling de arquivos no frontend. O painel expõe `storage_bytes` e `deleted_storage_bytes` como métricas internas calculadas — não são uma fatura do Supabase.

Para vídeos, não mude o método oficial atual sem um teste: upload de arquivo tende a transferir bytes via worker; `PULL_FROM_URL` exige domínio HTTPS verificado e hoje é usado para carrosséis. Um domínio próprio não é exigido em desenvolvimento, mas é uma dependência do TikTok para o fluxo de fotos em produção.

## Deploy e dependências

1. Execute `supabase db push` no projeto de homologação.
2. Execute `supabase functions deploy media-cleanup` com os segredos existentes `WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `TOKEN_ENCRYPTION_KEY`.
3. Faça build do frontend e configure apenas as variáveis públicas já existentes: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Não habilite cobrança: Stripe/Mercado Pago requerem produtos, webhooks assinados e credenciais reais, que não foram criados.
5. Não use Vercel Hobby para operação comercial. Migre de plano antes da comercialização, conforme os termos vigentes da Vercel e Supabase.

OAuth fora do Sandbox depende da aprovação do app TikTok. Enquanto estiver em Sandbox, somente contas adicionadas como Target Users podem conectar. A aprovação não concede promessa de resultado no Programa de Recompensas do Criador.

## Testes e recuperação

O front deve passar em `npm --prefix apps/web run typecheck`, `npm --prefix apps/web test` e `npm --prefix apps/web run build`. Os testes de banco são executados com `supabase test db` somente contra o stack local; não execute testes destrutivos contra produção. Testes de publicação devem mockar TikTok e Storage.

Em uma falha de limpeza, mantenha dry-run ativo, consulte `media_cleanup_audit`, verifique o status dos jobs e corrija/reexecute a função. Se a remoção do objeto ocorreu mas a atualização do banco falhou, a trava expira e a próxima execução faz a reconciliação idempotente. Nunca altere manualmente um job `UNKNOWN` para publicar; use o fluxo de reconciliação já existente.

## Evidências de homologação pós-deploy (2026-11-01)

Validação remota realizada sem upload para Storage, sem publicação para o TikTok e com transações de teste revertidas:

- A Vercel respondeu HTTP 200 e o bundle publicado contém as telas **Plano e consumo** e **Retenção de mídia**. Não havia sessão de navegador autorizada disponível para validar a navegação autenticada visualmente.
- Os cinco planos, uma assinatura Starter ativa e o ciclo de 120 publicações foram encontrados no banco. Uma transação temporária comprovou `RESERVED` na criação de um agendamento e `CONSUMED` após mudança para `PUBLISHED`; os registros temporários não permaneceram após `ROLLBACK`.
- Mídia fictícia publicada há 25 horas só ficou elegível depois da remoção de um job `UNKNOWN` compartilhado. O teste confirmou lock exclusivo, auditoria `DRY_RUN`, manutenção do status `READY` no dry-run e idempotência da finalização física simulada. O rollback impediu qualquer alteração persistente ou chamada ao Storage.
- O dry-run real da Edge Function retornou HTTP 200 com zero candidatos, zero dry-runs e zero objetos removidos. No ambiente atual não há histórico/mídia elegível, portanto ainda falta observar uma auditoria `DRY_RUN` persistente com um asset real de homologação.
- A função respondeu HTTP 401 sem `x-worker-secret`. A RPC de claim não tem execução para `anon` nem `authenticated`; apenas `service_role` a possui. As seis novas tabelas têm RLS ativo e políticas de leitura por workspace/papel.
- O cron `invoke-media-cleanup` está ativo a cada 15 minutos. Dois HTTP 500 foram registrados antes da correção de ambiguidade de `workspace_id`; após a migration `20261102000002_fix_media_cleanup_candidate_query.sql`, a resposta foi HTTP 200. `net._http_response` e `media_cleanup_audit` são os pontos de diagnóstico operacional.

## Evidências locais complementares (2026-11-01)

O stack Supabase local foi recriado com `supabase db reset`, aplicando todas as migrations até `20261102000002`. Em seguida, `supabase test db` passou integralmente: **8 arquivos e 93 testes**. As fixtures antigas de jobs ativos foram atualizadas para informar `music_rights_confirmed = true`, requisito já imposto pelo banco; o contrato de aprovação também passou a emitir TAP, eliminando um falso negativo do runner.

O script `scripts/test_local_concurrency.sh` abriu duas conexões PostgreSQL independentes contra o banco local. Com limite de ciclo igual a um, só uma confirmação concorrente de lote conseguiu reservar quota; a outra falhou de forma esperada. Em paralelo, uma transação manteve o claim de limpeza e a segunda recebeu zero candidatos por `FOR UPDATE SKIP LOCKED`. O script usa somente mídia fictícia sem objeto no Storage e remove o usuário/workspace de fixture no `trap` de saída.

O frontend também foi verificado no mesmo ciclo: `typecheck`, Vitest (**25 testes**) e build de produção passaram. Naquele build, ainda havia um aviso não bloqueante de chunk JavaScript acima de 500 kB; a divisão de rotas descrita abaixo o eliminou no build local mais recente.

Pendências de lançamento: validar a interface com uma conta de teste autenticada, registrar ao menos um candidato de homologação em dry-run persistente, configurar observabilidade/alerta externo para respostas não-2xx, concluir aprovação TikTok fora do Sandbox e configurar provedor de pagamentos/webhooks antes de qualquer cobrança.

## Aperfeiçoamento operacional de interface (2026-10-31)

Esta etapa não altera checkout, cobrança, migrations, Edge Functions nem a política remota de retenção. O frontend passou a carregar as páginas autenticadas sob demanda; no build local, o entrypoint inicial ficou em aproximadamente 180 kB (antes da carga das rotas), preservando a navegação e a identidade visual existentes.

O painel passou a separar **reconexão necessária** (token revogado ou reautorização requerida) de **aguardando ação TikTok** (`SENT_TO_INBOX` ou `UNKNOWN`), além dos indicadores já existentes de plano, quota, armazenamento, próximas publicações e falhas. A lista de canais agora oferece busca por nome/ID, filtros por estado e país e seleção múltipla apenas para revisão. Operações de OAuth continuam por canal, pois não é seguro nem compatível com a API oficial aplicar reconexão em massa.

A biblioteca mantém os registros de mídia removida visíveis como histórico: mostra bytes de objetos ainda armazenados, quantidade removida, data/motivo de retenção e bloqueio temporário de limpeza. Arquivos `DELETED` não aparecem como editáveis ou reutilizáveis. Isso é apenas representação do estado persistido; a exclusão real continua inteiramente no backend e só ocorrerá quando o dry-run for explicitamente desativado em ambiente autorizado.

### Evidências locais desta etapa

- A fixture pgTAP de retenção foi corrigida para contar somente o asset do próprio workspace de teste. Antes, um candidato criado por outra fixture local podia gerar falso negativo, apesar de o isolamento real estar correto.
- O teste continua cobrindo `UNKNOWN` bloqueando limpeza, grace period de 24 horas, lock exclusivo, dry-run/auditoria e idempotência da finalização simulada, sem Storage ou TikTok.
- A validação manual autenticada do dashboard, da página **Plano e consumo**, de reconexão OAuth e de preview de agendamento em lote continua pendente de uma sessão de homologação autorizada. Não se deve simular esses fluxos sem conta TikTok de teste aprovada.

## Grupos de contas e agendamento em lote (desenvolvimento local)

A migration `20261103000001_account_groups_and_publication_batches.sql` adiciona `account_groups` e `account_group_members`. Ambas têm `workspace_id`, RLS e FKs compostas para impedir que um grupo de um workspace receba uma conta de outro. A exclusão de grupo remove somente os vínculos, nunca a conexão OAuth ou o canal.

`publication_batches` registra a operação que originou jobs em massa. A RPC `confirm_publication_batch` exige membro com papel de edição, valida novamente canal conectado, mídia `READY`, data futura, legenda, duplicidade e workspace, e aceita no máximo 500 itens. A inserção dos jobs e suas reservas ocorre em uma única transação: se a quota ou qualquer regra rejeitar um item, o lote inteiro é revertido. A chave de idempotência é única por workspace e a mesma chave retorna o lote existente sem criar publicações extras.

O frontend usa um motor puro (`batchPlanner`) para a prévia de todos-para-todas, sequencial e equilibrada. Ele deduplica contas selecionadas diretamente e por grupos, calcula horários UTC a partir do fuso escolhido, aplica intervalo, dias permitidos e máximo diário por conta; bloqueios e avisos são mostrados antes da confirmação. A confirmação não chama TikTok. O CSV passa pela mesma RPC, eliminando dois caminhos distintos de criação.

### Limitações conhecidas e homologação manual

- A prévia é limitada a 500 itens por lote e o histórico mostra os 100 lotes mais recentes; isso mantém as consultas compatíveis com a infraestrutura inicial. Para volumes maiores, a próxima evolução é paginação de lotes e agregados SQL para o progresso, em vez de carregar até mil jobs no navegador.
- A tela de histórico exporta os itens já carregados; cancelar/reagendar/repetir continuam aplicando a máquina de estados individual existente. Uma ação coletiva para esses comandos exige uma RPC própria e homologação adicional, para não cancelar jobs em processamento.
- Testar visualmente grupos, o fluxo guiado, CSV, `DIRECT`/`INBOX` e contas com permissão restrita requer sessão autenticada e contas TikTok de homologação. Não use vídeos reais nem desative dry-run para essa validação.

## Finalização de lotes — desenvolvimento local

A migration `20261103000002_batch_management_and_carousels.sql` adiciona operações idempotentes de cancelamento e reagendamento (`cancel_publication_batch_items` e `reschedule_publication_batch_items`) e uma consulta paginada com agregados (`list_publication_batches`). Todas validam sessão, papel de edição, workspace e máquina de estados no banco. Apenas estados ainda editáveis podem ser alterados; `PROCESSING`, `PUBLISHED` e resultados ambíguos não são cancelados. O cancelamento usa a transição existente para `CANCELLED`, preservando a liberação transacional de quota.

O planejador aceita vídeo ou um conjunto ordenado de 1 a 35 imagens para `PHOTO`. A confirmação repassa `post_type` e `media_asset_ids` ao validador de mídia existente, que exige assets `READY`, do mesmo workspace, no tipo correto e conserva a ordem. O worker continua responsável por bloquear foto caso o domínio HTTPS verificado/PULL_FROM_URL não esteja disponível; o planejador não simula publicação nem expõe objetos privados.

O histórico de lotes agora busca páginas de 25 itens via agregado SQL e mostra percentual calculado somente com `PUBLISHED`, `FAILED` e `CANCELLED`. `UNKNOWN` e `SENT_TO_INBOX` permanecem aguardando ação, sem contar como sucesso. O detalhe permite selecionar itens elegíveis e solicitar cancelamento ou reagendamento em bloco; repetir um lote abre um novo rascunho editável com configurações originais disponíveis, sem criar jobs até a confirmação.

Evidência local da fase anterior: o banco foi recriado com as migrations até `20261103000002`; a suíte inicial passou com 10 arquivos/109 asserções. A validação atual desta Fase 3.2 acrescenta verificações de opções avançadas no pgTAP e está registrada abaixo; a homologação visual autenticada continua pendente.
# Configurações avançadas em lotes (Fase 3.2)

O agendador guarda as opções por item no rascunho: privacidade, permitir comentários, duetos/stitch para vídeo, declarações comerciais e consentimento de áudio. O detalhe de repetição reaproveita esses valores do job original, mas capacidades antigas não são tratadas como atuais: no modo Direct, o operador pode consultar `creator_info` para cada conta e o worker consulta novamente o TikTok imediatamente antes do envio.

O modo Direct/Inbox permanece uma configuração do workspace e não pode ser alterado por item. Fotos/carrosséis exigem Direct Post; a Content Posting API usada neste projeto aceita comentários e declarações comerciais para fotos, enquanto duetos/stitch são enviados somente em vídeo. Inbox não recebe campos de Direct Post. A RPC `confirm_publication_batch` verifica tipos, privacidade em relação às capacidades armazenadas, campos obrigatórios por tipo de mídia, modo de publicação e consentimento de áudio para vídeos; o worker continua sendo a autoridade para capacidades atuais e permissões do TikTok.

A API de publicação comum usada pelo AutoClipe não expõe a declaração de conteúdo gerado por IA encontrada no fluxo separado de TikTok Shop; por isso o editor não oferece esse controle em publicações comuns. Não há seleção de modo de publicação por linha. Se o app ainda não foi auditado, a prévia limita Direct Post à privacidade `SELF_ONLY`, conforme o bloqueio operacional existente. A repetição continua sendo apenas um rascunho: não persiste jobs nem reserva quota até a confirmação explícita.

Validação local desta fase: `npm --prefix apps/web run typecheck`, Vitest, build, `supabase db reset --local`, `supabase test db` e `bash scripts/test_local_concurrency.sh`. A homologação visual autenticada e consultas reais de capacidades dependem de sessão e contas autorizadas do TikTok; não são simuladas por estes testes.

## Reagendamento configurável e filtros do histórico (Fase 3.3)

O detalhe do lote permite reagendar de 1 a 500 itens elegíveis (`SCHEDULED`, `READY` ou `RETRY_WAIT`). A prévia usa ordenação determinística por horário original, criação e ID; a data/hora local inicial é convertida para UTC e os intervalos de 1 a 1440 minutos são somados como duração absoluta em UTC. Presets disponíveis: 5, 15, 30, 60 e 120 minutos. Horário local inexistente em mudança de fuso é bloqueado; horário repetido exige escolher explicitamente a primeira ou segunda ocorrência. Datas resultantes precisam estar no futuro.

Antes da confirmação, o frontend verifica equivalências exatas dentro da janela consultada. Se a consulta atingir o limite de 2000 resultados ou falhar, a confirmação permanece desabilitada. A RPC `reschedule_publication_batch_items` repete a validação no backend, exige o horário original esperado (controle otimista de versão), bloqueia em ordem estável, confirma estado/workspace/fuso/data, detecta conflitos no lote e em jobs existentes e atualiza tudo em uma transação. Lock advisory por workspace e chave de idempotência torna retries idempotentes; conflito concorrente com versão antiga retorna `batch_reschedule_stale`. A operação só altera horário e fuso: não cria jobs e não muda reservas de quota. Cancelamentos usam locks ordenados e idempotência pelo mesmo mecanismo.

O histórico mantém páginas de 25 lotes, agora filtradas antes da paginação no Postgres por status operacional, conta, grupo (quando associado), intervalo de criação UTC, ID exato do lote e pesquisa por ID/nome. O filtro de status seleciona lotes que contenham ao menos um job naquele estado; os indicadores de cada linha incluem todos os jobs daquele lote. O total é global para o conjunto filtrado, enquanto os indicadores detalhados são calculados apenas para os lotes da página solicitada. A ordem é `created_at DESC, id DESC`. `completed` e o percentual incluem apenas `PUBLISHED`, `FAILED` e `CANCELLED`; `SENT_TO_INBOX`, `UNKNOWN` e os estados `BLOCKED_*` são aguardando ação e nunca contam como publicação confirmada. A ordenação usa índice por workspace/data/ID; os filtros de status, canal, lote e grupos têm índices compostos/associações apropriados.

Datas do filtro do histórico são datas UTC e referem-se a `publication_batches.created_at`, não à data agendada das publicações. O filtro de status é por estado real de `publication_jobs`; os indicadores de cada lote incluem seus itens completos. A confirmação de reagendamento e a consulta prévia usam apenas dados do workspace autenticado. Validação local comprovada nesta execução: reset local concluído; pgTAP passou com 10 arquivos/129 asserções, incluindo lote fora da primeira página e allowlist MIME de imagens; concorrência real passou para reserva de quota, confirmação idempotente concorrente, rejeição de reagendamento com versão obsoleta e lock `SKIP LOCKED`; TypeScript passou; Vitest 45 testes passou; build passou; worker 25 testes passou; `git diff --check` passou. A revisão visual autenticada ainda depende de sessão de homologação e não foi simulada.

## Homologação integrada e auditoria (Fase 3.4)

Esta fase adiciona lock advisory por workspace/chave à confirmação de lotes para que duas confirmações concorrentes com a mesma chave retornem o mesmo resultado, em vez de competir na constraint única. A consulta paginada agrega os jobs somente para os 25 lotes da página; a contagem continua abrangendo todo o conjunto filtrado. Índices compostos auxiliam filtros por grupo, status e conta. A migration local `20261103000003_allow_image_media_uploads.sql` alinha o bucket privado aos formatos de imagem que o frontend já aceitava. Evidências verificáveis de segurança, desempenho, limitações de interface e implantação estão em `docs/PHASE_3_4_HOMOLOGATION.md`, `docs/SECURITY_AUDIT.md`, `docs/PERFORMANCE_BASELINE.md` e `docs/DEPLOY_RUNBOOK.md`.
# Homologação browser e recuperação local

A suíte Playwright local está em `apps/web/e2e` e é executada com `npm --prefix apps/web run test:e2e`. O runner exige Supabase API e PostgreSQL em loopback, cria usuários/workspaces fictícios, autentica pela UI e limpa somente objetos sob prefixos E2E criados na execução. Nenhuma fixture pode ser usada fora de localhost.

O Storage privado aplica allowlist de Content-Type declarado e tamanho. O serviço local não verifica assinatura binária: conteúdo que não corresponde ao MIME pode ser enviado diretamente, embora a UI valide decodificação e dimensões de imagens. Validar assinatura no backend é pendência de segurança antes de uploads não confiáveis.

O ensaio PostgreSQL é `npm --prefix apps/web run test:local:backup-restore`; cobre DB local e destino isolado, não objetos binários do Storage nem secrets. Ver `PHASE_3_5_E2E_HOMOLOGATION.md` para evidências e status.

# Worker local de validação (Fase 3.6)

`deploy/local-worker/compose.yaml` contém o worker de fila e um sidecar FFmpeg separado. O worker conversa com Supabase por HTTPS de saída e reclama tarefas nas RPCs existentes; o decoder recebe bytes apenas por bridge `internal` autenticada, sem egress/ports. Nenhum container monta Docker socket. Secrets são arquivos locais ignorados pelo Git e montados em Compose; service role permanece um risco privilegiado. O heartbeat é service-only e `/ready` distingue processo vivo de integração pronta. Ver `docs/PHASE_3_6_LOCAL_WORKER_AND_PILOT_READINESS.md` para instalação, systemd, benchmark e checklist Cloud. O Compose foi homologado com Supabase local; Cloud e reboot permanecem pendentes.
# Addendo operacional — upload validado (Fase 3.5.1)

Uploads de imagem novos seguem `begin_media_upload` → `media-quarantine` privado → Edge Function `media-validate` → gravação controlada em `media` → atestado SHA-256/MIME/tamanho e estado `READY/VALIDATED`. O navegador não consegue criar `media_assets`, gravar no bucket definitivo nem escrever os campos de validação. RPCs e workers rejeitam mídia sem atestado; worker compara o conteúdo armazenado com hash/tamanho antes de iniciar publicação.

JPEG, PNG e WebP são decodificados no servidor, com limites de tamanho e pixels. Upload de vídeo está temporariamente bloqueado porque o runtime Edge local testado não possui um decodificador completo confiável; a API rejeita com `VIDEO_VALIDATOR_UNAVAILABLE`. Não fazer release de `20261103000004_secure_media_validation_pipeline.sql` até resolver a revalidação de mídia histórica (`UNVERIFIED`) e o tratamento de jobs existentes. Nenhuma exclusão ou alteração remota foi executada.

# Adendo Fase 3.5.2 — pipeline de vídeo e legado

Uploads de vídeo usam `media-quarantine` → estado `VALIDATING` → worker Node/Docker local com FFprobe + decodificação FFmpeg integral → promoção imutável → `READY/VALIDATED` com hash SHA-256. Nesta implementação apenas MP4/H.264 (AAC opcional) é aceito; MOV/WebM são recusados. A Edge Function apenas autentica e enfileira o processamento. Agendamentos e worker bloqueiam qualquer mídia sem atestado.

Mídias antigas permanecem no mesmo ID e objeto durante revalidação. O inventário `scripts/inventory_legacy_media.sql` é somente leitura; o script de revalidação é dry-run por padrão e limita aplicação a localhost e workspace explícito. Jobs dependentes não são apagados nem têm reserva/quota alterada; retomada exige ação explícita e revalidação de estado/data/canal/reserva. Consulte o relatório da Fase 3.5.2 e o runbook antes de planejar implantação.

**Limitação:** o Supabase Edge Runtime não executa FFmpeg e Vercel + Supabase não disponibilizam worker Docker persistente automaticamente. Não habilitar vídeo fora do ambiente local até escolher e homologar runtime seguro, rede, recursos, autenticação, retentativas e monitoramento. Nenhum pagamento, deploy ou operação remota faz parte desta fase.
# Addendum — validação local de vídeo (Fase 3.6.1)

O serviço de validação no computador Ubuntu usa credencial HMAC específica da Edge API, sem service role no container residente. Claims só enxergam uploads cujo objeto de quarentena já foi persistido e size conferido pela Edge Function; o marker não é gravável por cliente. Worker permanece separado do publicador TikTok. Host offline mantém mídia pendente, sem promover ou publicar. Heartbeat é service-only; estados de health locais via loopback. Documentação e evidências em `PHASE_3_6_1_LOCAL_WORKER_SECURITY_AND_AUTOSTART.md`.
# Aditivo — Fase 3.6.2 (2026-11-01)

Foi criada uma ferramenta de inventário Cloud em modo opt-in, sem conexão automática: `scripts/cloud-audit/readonly-audit.mjs`. O manifesto local detectou 29 arquivos de migration e 12 diretórios locais de Edge Functions. `supabase migration list --local` conectou ao PostgreSQL local e mostrou 29 versões iguais no ledger local. Isso não informa o estado do Supabase Cloud.

Nenhuma credencial do ambiente foi usada para Cloud e nenhum recurso remoto foi consultado. A comparação de migrations, schema, RLS, Storage, mídias, jobs, quotas, Edge Functions, Auth e Vercel continua pendente de autorização explícita e credencial de leitura com privilégios comprovadamente mínimos. A aplicação mantém os bloqueios operacionais anteriormente documentados: linger/reboot não comprovados; concorrência integrada de duas instâncias Compose e falhas intermediárias da promoção também permanecem abertas.

> A descrição antiga de upload somente validado no cliente e de vídeo sem worker reflete auditorias anteriores. O estado local atualizado usa quarentena e validação confiável; o worker Docker valida MP4/H.264 localmente. Essa mudança ainda não foi confirmada no Cloud.
