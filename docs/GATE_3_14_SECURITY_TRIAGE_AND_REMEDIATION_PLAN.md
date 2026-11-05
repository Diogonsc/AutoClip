# Gate 3.14 — triagem de segurança e propostas de correção

## Escopo e evidência

Triagem local de código/migrations e análise dos relatórios read-only fornecidos no Gate 3.13. Nenhuma conexão adicional ao Cloud foi feita. Não houve alteração em migrations, aplicação, roles, grants, RLS ou dados Cloud. A role `autoclip_cloud_auditor` permanece `NOLOGIN`. O teste novo descrito neste documento altera apenas o conjunto local de testes e roda dentro de transação com `ROLLBACK`.

Classificações neste relatório:

- **Comprovado localmente:** comportamento reproduzido por código/teste local.
- **Configuração Cloud observada:** propriedade/ACL que apareceu no inventário, sem teste de exploração.
- **Risco potencial:** caminho condicionado por exposição, permissões, identidade ou configuração não observada.
- **Não verificado:** não há evidência disponível para fechar a conclusão.

Os relatórios Gate 3.13 mostraram PostgreSQL 17.11 e foram reconciliados no [relatório de reconciliação](GATE_3_13_CLOUD_RECONCILIATION_REPORT.md). Os corpos das funções Cloud, configurações de schemas expostos pelo PostgREST, valores do Vault, linhas/comandos cron e autorização runtime não foram coletados.

## A. pg_net: chamadas, alcance e propostas

### Dependências locais encontradas

| Origem | Função/rotina | Efeito do código local | Acesso/invocação local |
|---|---|---|---|
| `20261021000002_tiktok_integration.sql` | `private.invoke_publication_worker()` | Lê `project_url` e `worker_secret` de `vault.decrypted_secrets`; chama `net.http_post` para `/functions/v1/publication-worker` com `x-worker-secret`, timeout de 5 s. | SECURITY DEFINER, EXECUTE revogado de `PUBLIC`, `anon`, `authenticated`; agendado a cada minuto por `cron.schedule`. |
| `20261102000001_saas_entitlements_and_media_retention.sql` | `private.invoke_media_cleanup()` | Retorna cedo se nenhum workspace habilitou cleanup; caso contrário lê os mesmos dois secrets e chama `net.http_post` para `/functions/v1/media-cleanup`. | SECURITY DEFINER, EXECUTE revogado de `PUBLIC`, `anon`, `authenticated`; agenda a cada 15 minutos. A migration está no ledger observado, mas o job ativo não foi consultado. |
| Edge `publication-worker` | endpoint chamado pelo cron | Verifica `WORKER_SECRET` via handler e usa service client para processar publicação, TikTok Shop, leases e mídia. | Localmente `verify_jwt=false`, segredo compartilhado no header. Deploy/config Cloud não verificados. |
| Edge `media-cleanup` | endpoint chamado pelo cron | Usa comparação timing-safe do segredo; reivindica candidatos por RPC, e remove Storage somente segundo resultado/configuração do job. | Cleanup por padrão desativado/dry-run segundo código local; settings e deploy Cloud não verificados. |

Busca em migrations e Edge Functions encontrou as duas chamadas de extensão acima; não encontrou outras chamadas `net.http_get`, `net.http_delete` ou chamadas HTTP pg_net em Edge Functions. Não significa ausência de uso fora do worktree.

### Evidência de ACL Cloud no Gate 3.13

O relatório de ACL observou `USAGE` em schema `net` concedido a `PUBLIC`; `EXECUTE` público nas funções de `net` como `http_get`, `http_post`, `http_delete` e funções auxiliares; ACL pública ampla nas tabelas `net.http_request_queue` e `net._http_response` (incluindo SELECT, DML, TRUNCATE, TRIGGER, REFERENCES e MAINTAIN), além de ACL pública na sequence da fila. O catálogo mostrou RLS desabilitada nas duas tabelas. Essas permissões são efetivas para roles de banco por herança de PUBLIC quando há sessão/uso do schema; a ACL observada não prova que o schema `net` está exposto pela API PostgREST nem que um endpoint de aplicação permita SQL arbitrário.

### Risco, pré-condições e impacto potencial

- **Abuso de HTTP/SSRF:** uma role de banco com acesso efetivo pode tentar enfileirar solicitações para destinos arbitrários. O alcance depende de egress/restrições de rede e de como `pg_net` valida destino; nada disso foi testado.
- **Exfiltração:** URL, parâmetros e headers são controláveis pela função HTTP. Segredos do Vault não aparecem automaticamente para quem chama `net.http_post`; seria necessária outra via para ler/injetar valor secreto. Ainda assim, requests arbitrários podem exfiltrar dados que o chamador já controla ou explorar serviços alcançáveis pela rede.
- **Interferência em fila/respostas:** DML público e RLS desligada permitem, no nível PostgreSQL, tentativa de observar/manipular os catálogos operacionais se a role tem conexão e schema access. Uso direto via PostgREST depende de `net` estar entre schemas expostos, não verificado.
- **Worker e disponibilidade:** solicitações extras podem consumir fila/egress/recursos; DML direto pode interferir na fila. Não se demonstrou impacto no worker Cloud.
- **Segredo do worker:** o wrapper privado que lê Vault tem EXECUTE fechado para roles cliente no código local. A ACL Cloud do wrapper e os secrets não foram inspecionados por conteúdo; a rotina aparece como SECURITY DEFINER sem EXECUTE a `authenticated`/`PUBLIC` no inventário de rotinas. Isso reduz o caminho direto conhecido, mas não prova a configuração Edge.

### Opções de menor privilégio; nenhuma aplicada

1. Verificar a configuração oficial de schemas expostos pela Data API e retirar `net` da exposição se não for requisito. Isso reduz a superfície REST sem tocar no cron.
2. Remover EXECUTE de `PUBLIC` das rotinas HTTP/auxiliares não necessárias a clientes e conceder apenas ao principal efetivo que chama as duas funções SECURITY DEFINER. A identidade efetiva e o owner/grants precisam ser provados antes; Gate 3.13 mostra `http_post` com owner `supabase_admin` e execução pública, enquanto os wrappers cron são owned por `postgres`. Uma revogação sem grant direto correto pode quebrar dispatch.
3. Remover ACLs de tabela/sequence de `PUBLIC`, mantendo apenas os privilégios exigidos pelo worker interno/extensão. Testar ciclo de enqueue, coleta de resposta e cron em sandbox; não revogar em lote sem confirmar o modelo de execução da extensão.
4. Restringir egress no nível de rede/projeto, quando suportado, como defesa complementar contra SSRF. Não substitui ACLs.

**Risco de regressão:** indisponibilidade de publicação/cleanup agendado, falha de leitura de respostas, filas estagnadas ou quebra de integração da extensão. Antes de qualquer alteração: mapear owners/ACLs/dependências, consultar a configuração de schemas API, montar teste local/sandbox com scheduler, e preparar observabilidade/rollback. Alteração Cloud exige gate e autorização específicos.

## B. RPCs SECURITY DEFINER

### `public.change_workspace_plan(uuid,text)`

**Cloud observado:** owner `postgres`; SECURITY DEFINER; `search_path=""`; EXECUTE para `authenticated`; sem EXECUTE para `PUBLIC`/`anon`. **Código local:** `20261102000001_saas_entitlements_and_media_retention.sql`. Correspondência do corpo implantado não verificada.

O corpo local chama `private.can_admin(p_workspace)`, cuja cadeia `private.can_admin` → `private.role_in` consulta `auth.uid()` e somente OWNER/ADMIN. Assim, identidade nula e usuário de outro workspace falham; não há alteração cross-tenant evidente no código. A função escolhe um `billing_plans` ativo, bloqueia a assinatura do workspace com `FOR UPDATE`, ativa a assinatura, limpa cancelamento, atualiza limite para não ficar abaixo de consumo+reservas e grava `PLAN_CHANGED_MANUAL` com `auth.uid()`.

**Comportamento de produto e lacunas:** a UI local mostra “Selecionar para teste” e informa que cobrança real não está ativada. A RPC permite que OWNER/ADMIN escolha qualquer plano ativo sem pagamento e sem uma verificação de OWNER da plataforma. Isso é compatível com o fluxo local de teste, não uma exploração demonstrada; torna-se risco de entitlement quando os planos forem tratados como pagos. Repetir a mesma seleção ainda insere novo evento; não é idempotente em auditoria. Se uma assinatura não existir, o `UPDATE` pode afetar zero linhas enquanto o evento ainda é inserido (workspace normal ganha subscription por trigger; cenário legado/incompleto requer teste). O limite calculado preserva reservas/consumo existentes, mas permite aumentar quota até qualquer plano ativo.

**Proposta futura:** enquanto não houver cobrança, desabilitar seleção livre no ambiente que represente produto real ou explicitar como ferramenta de sandbox. Antes de billing, substituir a autoridade de cliente para atribuir planos pagos por um fluxo controlado (por exemplo, backend/webhook verificado ou OWNER da plataforma) e tornar o registro idempotente/auditável. Nenhuma dessas mudanças foi feita.

### `public.resolve_unknown_job(uuid,text)`

**Cloud observado:** owner `postgres`; SECURITY DEFINER; `search_path=""`; EXECUTE para `authenticated`; sem EXECUTE para `PUBLIC`/`anon`. **Código local:** `20261021000002_tiktok_integration.sql`. Correspondência do corpo Cloud não verificada.

O corpo local busca e bloqueia a linha do job (`FOR UPDATE`), exige `private.can_edit(workspace_id)` e estado `UNKNOWN`, aceita apenas `PUBLISHED`/`NOT_PUBLISHED` e grava evento `MANUAL_RESOLUTION` com o ator. `PUBLISHED` aciona o trigger local de quota para consumir reserva; `NOT_PUBLISHED` retorna a `SCHEDULED`, limpa tentativa/ID remoto e mantém reserva. A segunda resolução é bloqueada pelo estado. Não há cross-tenant evidente no corpo local.

**Risco funcional:** qualquer EDITOR pode declarar que conferiu manualmente o TikTok, marcar PUBLISHED e consumir quota ou marcar NOT_PUBLISHED e recolocar o job na fila. Se a verificação humana estiver errada, pode haver histórico falso ou reenvio duplicado; não há confirmação automática do TikTok na RPC. `UNKNOWN` existe precisamente porque o estado remoto pode estar ambíguo. O teste atual registra como política local esperada que EDITOR pode resolver, mas não testa um processo humano real nem publica conteúdo.

**Proposta futura:** antes do piloto, decidir se resolução deve ser exclusiva de OWNER/ADMIN ou operador de suporte, exigir confirmação explícita da verificação remota e preservar trilha de decisão. Para `NOT_PUBLISHED`, avaliar reconciliação adicional antes de limpar `remote_publish_id`/resetar tentativas. Não presumir que o estado `PUBLISHED` constitui confirmação da plataforma.

### `SECURITY DEFINER`, RLS, Storage e Vault correlatos

- As duas RPCs têm `search_path` vazio e nomes de schema qualificados no corpo local. A cadeia de autorização `private.*` também é SECURITY DEFINER e tem `search_path` vazio; esta é uma mitigação contra shadowing de objetos, não uma prova de que todas as policies sejam corretas.
- Gate 3.13 observou RLS em 30 relações de `public`; nove sem policy: `oauth_connections`, `oauth_states`, `platform_flags`, `platform_owners`, `platform_user_settings`, `publication_approval_links`, `tiktok_shop_connections`, `tiktok_shop_oauth_states`, `worker_leases`. RLS sem policy normalmente nega linhas a roles sujeitas a RLS, mas grants, owner, `service_role`/BYPASSRLS e RPCs SECURITY DEFINER continuam relevantes. Testes runtime Cloud não foram feitos.
- `storage.objects` tinha cinco policies observadas para o bucket `media`, baseadas em `private.storage_workspace(name)` e membership/role. Bucket `media` estava privado. Não foi feito teste cross-workspace; localmente o caminho é o UUID no primeiro segmento, e policies da migration de quarentena ainda são LOCAL_ONLY.
- ACL de `vault.decrypted_secrets` permite leitura a `service_role`; nenhum valor foi lido. Os cron wrappers consultam `project_url` e `worker_secret`. Segredos, rotação, Edge deployments e exposed schemas não foram verificados.

## C. Oito migrations LOCAL_ONLY: dependências e rollout

| Versão/arquivo | Mudanças principais e dependências | Compatibilidade/risco/rollback |
|---|---|---|
| `20261103000001_account_groups_and_publication_batches.sql` | Cria grupos, membros, lotes; coluna `publication_jobs.batch_id`, FK composta workspace/lote; policies/grants; RPC batch transacional. Depende de schema base, helpers `private.*`, canais, jobs e quota existente. | Aditiva; FKs `ON DELETE CASCADE` em workspace/grupo/canal podem remover associações relacionadas ao apagar pai; índice/FK afetam lock e escrita. Remoção down apagaria batches. |
| `20261103000002_batch_management_and_carousels.sql` | Cria operações de lote; substitui confirmação e inclui cancelamento/reagendamento/listagem, PHOTO e validações; índices. Depende integralmente da 01, enums/jobs e triggers de quota/media. | Aditiva mas amplia superfície RPC; funções SECURITY DEFINER. Índices comuns podem bloquear/esgotar I/O; tabela de operação contém auditoria/idempotência que não deve ser descartada. |
| `20261103000003_allow_image_media_uploads.sql` | Atualiza `storage.buckets.media.allowed_mime_types` para incluir JPEG/PNG/WebP e falha se bucket ausente. | DML em Storage config; muda uploads aceitos. Reversão exige estado anterior conhecido; pode impedir novos uploads de imagem. |
| `20261103000004_secure_media_validation_pipeline.sql` | Adiciona estado/colunas de validação, atualiza todas as mídias existentes, índice, trigger; revoga insert direto e RPC antiga; cria `media-quarantine`; remove policies antigas de insert/update/delete e adiciona policies de quarantine; cria RPCs de upload/validação. Depende de base Storage, helpers e função de promoção existente. | Mudança funcional incompatível de fluxo; `UPDATE` em toda `media_assets` gera WAL/tempo/lock; revogação pode interromper cliente antigo; DML/upsert de bucket não reversível sem snapshot de config. Down pode perder atestados e objetos de quarentena. |
| `20261103000005_video_validation_and_legacy_revalidation.sql` | Amplia estados/claims/leases e índices; substitui cleanup e validação; rotinas service-only; altera MIME de `media-quarantine` para MP4 + imagens; rotina de revalidação legada. Depende das colunas, bucket e functions da 04. | Reescreve constraint e rotina de cleanup; scanner/worker compatíveis são necessários. MIME anterior `quicktime/webm` é removido de quarentena intencionalmente para alinhar validador MP4; testar UX e rejeição clara. ALTER/índices podem bloquear. |
| `20261103000006_video_worker_heartbeat.sql` | Cria tabela de heartbeat RLS e RPC service-only. | Aditiva; deve vir antes do worker que chama RPC. Sem deploy compatível, chamada pode falhar; RLS sem grants cliente é intencional. |
| `20261103000007_video_worker_api_credentials.sql` | Cria nonce anti-replay, RPC service-only, validações completas/rejeição/liberação com claim token. Depende do pipeline 04/05. | Aditiva, mas RPC de consumo apaga nonces expirados e altera dados; exige segredo/HMAC/Edge alinhados. Rollback elimina estado anti-replay e pode reabrir replay se removido enquanto API estiver ativa. |
| `20261103000008_gate_video_validation_on_storage_upload.sql` | Adiciona `upload_completed_at`, revoga update cliente, cria RPC service-only para confirmar objeto/quota e restringe claim a upload completo. Depende de bucket quarantine, funções de validação e Edge media-validate da 04–07. | Muda gating: sem Edge compatível, mídia fica pendente e não entra na fila. Índice e coluna aditivos; down pode reabilitar fluxo inseguro se removido sem coordenação. |

### Ordem e rollout documental

Manter a ordem 01→08. Antes de planejar Cloud, fixar commit/tag e hashes dos oito arquivos, confirmar estado/backup restaurável de DB e Storage, revisar cada política/RPC/índice com owner, e reproduzir em sandbox equivalente PG17.11. Coordenar versão de frontend, Edge Functions, Storage policies/bucket e worker; migrations 04–08 são um corte de fluxo, não deploy isolado sem compatibilidade. Se for necessário, colocar upload/worker em manutenção controlada durante a transição. Aplicar em etapas aprovadas individualmente, com observação de erros/filas antes de avançar. Rollback preferido: parar consumidores e fazer correção forward; restaurar DB e Storage somente em ambiente isolado ou plano previamente ensaiado. Não há plano down aprovado; não executar `DROP` de tabelas/colunas ou apagar bucket/dados para “reverter”. Nenhuma migration será executada sem gate próprio.

## D. Matriz priorizada de riscos

| ID | Classe | Evidência e pré-condições | Impacto potencial | Proposta | Regressão/testes | Alteração Cloud? |
|---|---|---|---|---|---|---|
| G314-01 | Configuração Cloud observada + risco potencial — **ALTO** | ACL PUBLIC efetiva em `net`, HTTP routines e fila/respostas; precisa conexão SQL ou API com schema exposto. | SSRF/egress, abuso de fila, carga ou leitura/manipulação operacional. Exploração não demonstrada. | Revisar schema exposure; reduzir USAGE/EXECUTE/ACLs apenas a principals necessários após mapear cron. | Testar publicação e cleanup agendados, acesso negativo por authenticated/anon e fila após mudança. | Sim, se conceder/revogar ACL/exposure. |
| G314-02 | Configuração Cloud observada; corpo local apenas — **ALTO antes de billing** | `change_workspace_plan` SECURITY DEFINER/EXECUTE authenticated confirmado; owner/admin no próprio workspace pelo corpo local. | Alteração manual de entitlement/limites sem pagamento, conforme design atual de teste. | Antes de billing real, retirar autonomia de cliente para planos pagos; autorizar somente autoridade de billing/verificação ou platform owner. Tornar evento idempotente. | Tenant cruzado, roles, plano inativo, concorrência, evento duplicado, quota/reservas. | Sim para grant/function; aguardar autorização. |
| G314-03 | Configuração Cloud observada; risco funcional potencial — **ALTO** | `resolve_unknown_job` EXECUTE authenticated; local aceita EDITOR e confia na conferência humana. | Histórico falso, consumo de quota ou requeue que pode duplicar publicação se decisão errar. | Decidir papel mais restrito e confirmação/registro de evidência; reconciliar estado antes de reenviar. | Cross-tenant, viewer/editor/admin, estado inválido, repetição/concor­rência, reservation consumed/released, simular ambiguidade TikTok sem publicar. | Provável alteração de função/grant; gate específico. |
| G314-04 | Divergência local×Cloud — **ALTO para deploy/homologação** | 8 migrations ausentes no ledger e objetos alvo ausentes no inventário; sem prova de que executá-las é apropriado. | Recursos de lote/carrossel e segurança de validação/heartbeat não estão refletidos no Cloud observado; aplicação desalinhada. | Revisar sequência e rollout/rollback; aprovar separadamente. | PG17.11 sandbox; tests de upload/worker/nonce/lotes; lock e WAL; backups DB+Storage. | Sim para implantação futura, ainda não autorizada. |
| G314-05 | Teste de segurança incompleto — **ALTO** | Há pgTAP local de isolamento; faltava cobertura dedicada de `change_workspace_plan`/cross-tenant RPC. | Regressão de autorização poderia escapar detecção. | Adicionado teste sintético de 21 assertions; ampliar com concorrência e teste runtime de cópia homologação. | Novo pgTAP passou local, sem dados reais. | Não para teste local; sim para homologação remota posterior. |
| G314-06 | RLS/Storage não testados runtime — **ALTO** | Policies catalogadas; todos os 30 public rels com RLS, nove sem policy; cinco policies Storage. | Bypass via grants/RPC/service role, path/cross-tenant ou acesso inesperado. | Testes de dois workspaces e roles; revisar no-policy por intenção e grants. | Matriz allow/deny de SELECT/INSERT/UPDATE/DELETE, signed URL e Storage objects sintéticos. | Não para teste local; nenhuma alteração agora. |
| G314-07 | Segredos/Vault/Edge não verificados — **ALTO** | ACL metadata mostra service_role lendo `vault.decrypted_secrets`; sem valores. | Vazamento de worker secret permite invocar funções internas; acesso indevido a tokens pode publicar em contas vinculadas. | Revisar acesso, rotação, logs e `verify_jwt` no painel; segredos sem exportação. | Testar segredo incorreto/ausente e timing-safe local; nunca revelar valores. | Painel/Edge exige autorização separada. |
| G314-08 | Scheduler não verificado — **MÉDIO/ALTO** | Extensão e código `cron.schedule` existem; jobs e comandos não foram consultados. | Worker/cleanup pode estar ausente, duplicado ou ativo com endpoint/secret incorreto. | Auditoria manual de job metadata operacional autorizada; não invocar. | Verificar um job por função, intervalo, owner, alertas e dry-run em sandbox. | Sim para consulta operacional; autorização específica. |
| G314-09 | Proteção de teste insuficiente — **MÉDIO** | Resolve UNKNOWN testava Viewer e Editor permitido; não testava cenário cross-workspace/duas funções em conjunto. | Capacidade de editor de tomar decisão operacional ambígua sem confirmação externa. | Teste novo cobre outsider, viewer, editor, estados e quota; decisão de role ainda pendente. | 21 assertions pgTAP passaram. | Não para teste local. |

## E. Checklist de segurança para futuro gate

- [x] Confirmar grant Cloud e propriedades (somente metadados Gate 3.13).
- [x] Revisar corpo local e owners/search_path documentados das duas RPCs.
- [x] Testar localmente negação por usuário de outro workspace, Viewer, Editor em `change_workspace_plan`, plano inválido e falta de `auth.uid()`.
- [x] Testar `resolve_unknown_job` com estado inválido, Editor, repetição e efeitos de quota.
- [ ] Confirmar igualdade do corpo implantado por fluxo aprovado, sem inferir por assinatura.
- [ ] Decidir autoridade de plano quando houver billing real.
- [ ] Decidir papel/confirmador humano para UNKNOWN e barreira contra publicação duplicada.
- [ ] Verificar PostgREST exposed schemas e grants efetivos de authenticated/anon em `net`.
- [ ] Mapear execução cron da função SECURITY DEFINER até `net.http_post`; testar se revogação mínima mantém worker.
- [ ] Testar negative API e tentativa egress em sandbox, nunca Cloud produção.
- [ ] Exercitar os oito scripts em sandbox PG17.11 com snapshot Storage, carga de tabela e plano de interrupção.
- [ ] Validar cada policy Storage/RLS com workspace A/B e roles sintéticas.
- [ ] Verificar secrets/Edge/Auth em interface oficial sem copiar valores.

## F. Critérios para autorizar futuro Gate de correções

1. Proprietário aprova escopo e ambiente alvo (sandbox preferido), riscos e rollback.
2. Para pg_net: exposição API, ACLs efetivas, owner/caller, necessidade por rotina e compatibilidade cron foram comprovados; SQL fica por objeto/principal, revisado e hash-pin.
3. RPCs: política de produto para planos e resolução UNKNOWN foi decidida; corpos implantados foram comparados ou divergência registrada; testes de autorização/concorrência passam.
4. Migrations: as oito versões são revisadas em ordem, com backup restaurável de banco e inventário/backup Storage; objetos externos e código Edge/worker têm sequência compatível; plano de pausa e recuperação ensaiado.
5. Homologação: dois workspaces sintéticos, sem contas/pessoas/mídias reais, com evidência allow/deny; sem publicação real sem aprovação específica TikTok.
6. Cada arquivo SQL/alteração Cloud requer autorização individual por hash; Gate de preparação não autoriza execução.

## Testes executados neste Gate

- `supabase test db --local supabase/tests/database/02_tiktok_integration.test.sql supabase/tests/database/07_saas_entitlements.test.sql`: 49/49 pgTAP passaram.
- Novo `supabase test db --local supabase/tests/database/15_rpc_security_triage.test.sql`: 21/21 pgTAP passaram.
- Todos os arquivos de teste usam transação `BEGIN`/`ROLLBACK`; `--local` foi explícito. Nenhuma migration foi aplicada nesta etapa e não houve conexão Cloud.

## Decisão

Não foi demonstrada exploração ou cross-tenant no código local testado. Há ACL Cloud de alto impacto observada em `pg_net`, RPCs SECURITY DEFINER expostas a `authenticated` com efeitos sensíveis e uma divergência de implantação de oito migrations. Isso exige investigação e decisão antes de homologação; não autoriza correção remota. Não foram modificados códigos de produção nem SQL de migrations.
