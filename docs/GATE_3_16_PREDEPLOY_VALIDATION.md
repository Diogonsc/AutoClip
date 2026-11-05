# Gate 3.16 — validação pré-deploy local

## Parecer

**NO-GO para implantação Cloud; validação local concluída para revisão.** A RPC `resolve_unknown_job` passou nos cenários multi-sessão reproduzidos em PostgreSQL local isolado, incluindo replay concorrente e concorrência de autorização. As nove migrations mais recentes foram aplicadas no harness descartável que as testa, e a suíte pgTAP no Supabase local persistente passou. Isso não aprova implantação: não houve reconciliação Cloud nova, e a migration 09 remove a assinatura antiga da RPC, o que exige rollout compatível com bundles em cache.

Nenhuma conexão ou alteração Cloud ocorreu. Não houve alteração na role `autoclip_cloud_auditor`; permanece `NOLOGIN` conforme evidência anterior. Não houve deploy, publicação real, cobrança, limpeza física, commit ou push.

## Escopo e evidência

Foram revisados a migration 09, o teste pgTAP `15_rpc_security_triage`, os consumidores da RPC, o harness concorrente criado para este gate, a suíte web e a documentação Gate 3.14/3.15. Os testes usam fixtures sintéticas e Supabase/PostgreSQL local. Os relatos de estado Cloud abaixo são históricos dos Gates 3.11–3.13, não foram atualizados neste gate.

## A — Concorrência e idempotência de `resolve_unknown_job`

O harness `scripts/test_gate_316_rpc_concurrency.mjs` sobe uma stack local temporária com as migrations presentes no repositório, prepara jobs/workspaces sintéticos, e usa duas sessões PostgreSQL. A sessão B só é considerada concorrente após observação de espera por lock; depois a sessão A continua e confirma a transação. O harness aplica timeouts e remove somente o diretório e stack temporários que ele próprio criou.

Resultado: **39/39 assertions passaram**.

| Cenário | Resultado observado |
|---|---|
| Mesmo request ID, ator, job e resultado, duas sessões sobrepostas | Segunda sessão esperou o lock e retornou sucesso; uma transição, uma reserva consumida, um evento e uma linha de auditoria. |
| Replay após commit | Sucesso idempotente, sem efeitos adicionais. |
| Mesmo request ID com resultado diferente | Rejeitado (`request id already used`); efeitos não duplicados. |
| Dois request IDs para o mesmo job | Segunda chamada esperou e foi rejeitada por estado não `UNKNOWN`; um único efeito. |
| Administrador autorizado e usuário de outro workspace simultâneos | Chamada não autorizada foi negada (`job not found`); nenhum efeito adicional. |
| Resultado `NOT_PUBLISHED` | Job voltou a `SCHEDULED`; reserva permaneceu `RESERVED`; eventos/auditoria únicos. |
| Quota agregada | Jobs publicados consumiram quota; reserva do caso não publicado permaneceu reservada. |
| Deadlock/timeout | Não ocorreu nos casos controlados; sessões terminaram dentro dos limites definidos. |

Isso é evidência reproduzível para os interleavings exercitados, não prova matemática de ausência de deadlocks sob carga arbitrária. Não foram testadas contenções prolongadas, competição de muitas sessões, deadlocks envolvendo outras rotinas de quota nem falha de rede exatamente durante o commit.

## B — Autorização de planos e de resolução

A migration 09 restringe `change_workspace_plan` a `public.is_platform_owner()` ou contexto `service_role`, rejeita assinaturas cujo provedor não é `MANUAL`, valida plano ativo e bloqueia/atualiza assinatura e ciclo de uso em transação. A leitura de planos e consumo permanece separada da mutação. O teste local adicionou um caso sintético de provedor `STRIPE`: a tentativa manual por `service_role` foi negada e o plano permaneceu inalterado. Nenhuma cobrança foi criada.

Os testes pgTAP cobrem OWNER, ADMIN, EDITOR, VIEWER e usuário de outro workspace, operador de plataforma, caminho interno `service_role`, plano inválido e tentativas de escrita direta nas tabelas de assinatura/quota. Resultado final da suíte local: **222/222 assertions em 15 arquivos**.

Limites: a confiança no `service_role` depende da proteção de segredos do backend; não há evidência de auditoria de segredos implantados neste gate. A autorização da interface é apenas UX; a função PostgreSQL continua sendo o controle efetivo.

## C — Compatibilidade RPC/frontend

Busca estática encontrou um consumidor de produção da RPC: `apps/web/src/components/JobDetail.tsx`. Os demais usos encontrados são definição/grants em migrations e testes pgTAP (`02_tiktok_integration.test.sql`, `15_rpc_security_triage.test.sql`). Não foram encontrados consumidores da RPC nas Edge Functions ou no worker local.

A assinatura atual é `resolve_unknown_job(uuid,text,uuid)`; a migration 09 remove `resolve_unknown_job(uuid,text)`. **Bundles web antigos em cache não são compatíveis** após a remoção: continuarão enviando a assinatura antiga e receberão erro do PostgREST. A interface nova gera um `request_id` por tentativa lógica e mantém a chave em memória para retries. Não deve haver fallback automático à RPC antiga, pois não preservaria a semântica explícita de idempotência.

Plano recomendado antes de qualquer implantação:

1. Preparar uma fase transitória aprovada: publicar a assinatura de três parâmetros e manter a assinatura antiga como stub fail-closed, sem mutação, com erro que instrua atualizar/recarregar o cliente. Não criar um UUID implícito nem delegar a operação antiga.
2. Confirmar atualização do schema cache do PostgREST e testar cliente novo/antigo em staging.
3. Publicar frontend novo; observar chamadas/erros de clientes antigos e documentar período de cache.
4. Remover o stub em migração posterior, após critério de adoção acordado.

Alternativa: janela de manutenção que desabilite temporariamente a resolução manual durante o corte. A migration 09 atual, sem fase transitória, não atende rollout sem interrupção de clientes com bundle antigo. Não foi implementada alteração adicional nesta etapa.

A RPC apenas reconcilia o estado de um job `UNKNOWN`; não inicia publicação. A rejeição de cliente antigo é fail-closed, mas a prevenção de duplicidade da publicação depende também do worker e da reconciliação TikTok, ainda sujeita à homologação integrada.

## D — Nove migrations locais fora da evidência Cloud histórica

O repositório contém 30 migrations locais no total. O último inventário Cloud disponível registrou 21 identificadores, e os oito arquivos abaixo foram classificados como locais apenas naquele momento. A migration 09 foi criada depois daquele inventário. **Os relatórios dos Gates 3.13/3.14 não comparam o conteúdo SQL, e nenhuma consulta Cloud foi feita neste gate.** Assim, “LOCAL_ONLY” abaixo significa ausente do ledger observado historicamente, não uma nova afirmação sobre o estado Cloud atual.

| Ordem | Migration | Dependência/risco principal |
|---:|---|---|
| 1 | `20261103000001_account_groups_and_publication_batches.sql` | Schema base, canais, jobs e quota; cria grupos/lotes, FKs, policies e RPCs. |
| 2 | `20261103000002_batch_management_and_carousels.sql` | Depende de 01; amplia operações em lote e carrosséis. |
| 3 | `20261103000003_allow_image_media_uploads.sql` | Altera MIME allowlist do bucket `media`; requer bucket e política Storage compatíveis. |
| 4 | `20261103000004_secure_media_validation_pipeline.sql` | Pipeline/quarantine, policies e atualização de linhas existentes; possível WAL/lock e mudança incompatível para clientes antigos. |
| 5 | `20261103000005_video_validation_and_legacy_revalidation.sql` | Depende de 04; altera estados/claims, validação e cleanup. |
| 6 | `20261103000006_video_worker_heartbeat.sql` | Infra de heartbeat e RPC interna; worker precisa de versão compatível. |
| 7 | `20261103000007_video_worker_api_credentials.sql` | Anti-replay e autenticação da API interna; depende do pipeline e dos segredos/configuração Edge. |
| 8 | `20261103000008_gate_video_validation_on_storage_upload.sql` | Depende do fluxo de upload/validação anterior; mídia não avança sem confirmação de upload. |
| 9 | `20261103000009_harden_manual_plan_and_unknown_resolution.sql` | RPCs de plano e resolução de job; remove assinatura antiga de resolução e cria trilha idempotente. |

### Estratégia de rollout

1. Congelar revisão por arquivo e hash e comparar o estado implantado atual por mecanismo aprovado; IDs de ledger não provam igualdade de conteúdo nem compatibilidade dos objetos.
2. Ensaiar a cadeia completa em staging descartável com PostgreSQL compatível e snapshot/configuração Storage sintéticos. Medir duração, locks, WAL e efeitos do backfill da 04.
3. Coordenar deploy compatível de Edge Functions, worker, Storage e frontend para as migrations 03–08; verificar health/filas em cada etapa e parar ao primeiro erro.
4. Tratar a 09 como rollout separado, usando fase transitória de RPC acima ou janela de manutenção. Não aplicá-la isoladamente enquanto bundles antigos puderem operar.
5. Aplicar migrations em ordem, cada uma com aprovação própria, janela, backup comprovadamente restaurável, observação e critério de parada. Nenhuma etapa deste plano está autorizada agora.

### Rollback e recuperação

Não há rollback SQL reverso genérico aprovado. Testar restauração antes do piloto, incluindo configurações/objetos Storage. Em falha após commit, interromper a sequência e reconciliar o estado; preferir correção forward. Não executar `db reset`, `DROP`, remoção de objetos de quarantine ou rollback manual no Cloud. Para a 09, rollback de RPC não deve reabrir autorização de plano nem retirar registros de idempotência. Definir plano específico de recuperação e compatibilidade antes da aprovação da migração.

## E — `pg_net`

O mapeamento anterior descreve chamadas locais `net.http_post` em wrappers de publicação/limpeza e cron relacionado. Os relatórios Cloud históricos mostraram ACLs amplas envolvendo schema/funções/objetos da extensão. Isso demonstra permissões observadas naquele inventário, mas não prova alcance via PostgREST, principal efetivo usado pelo cron, exploração SSRF, leitura de conteúdo da fila ou impacto no worker.

Neste gate não houve nova consulta Cloud, chamada HTTP nem alteração ACL. Estado de exposição efetiva, schemas expostos pela Data API, grants atuais e dependências implantadas: **NOT_VERIFIED**. Não aplicar `REVOKE` global. Próximo estudo deve mapear caller/owner/ACL por objeto e testar cron → extensão → worker em sandbox antes de propor privilégio mínimo.

## F — Validação executada

| Verificação | Resultado |
|---|---|
| `node scripts/test_gate_316_rpc_concurrency.mjs` | Passou, 39 assertions; stack PostgreSQL local isolada e fixtures sintéticas. |
| `supabase test db --local` | Passou, 15 arquivos / 222 assertions, incluindo os dois casos de assinatura gerenciada adicionados ao teste local. |
| `npm run test --prefix apps/web` | Passou, 5 arquivos / 45 testes. |
| `npm run typecheck --prefix apps/web` | Passou; também executado como primeira etapa de `npm run build`. |
| `npm run build --prefix apps/web` | Passou; Vite transformou 2.413 módulos e concluiu build. |
| `supabase db lint --local --schema public,private,storage --fail-on error` | Sem erro bloqueador. Avisos: conversão de tipo em `delete_platform_user`, variáveis não utilizadas em funções de cleanup/validação e warnings em funções internas `storage.search*`. Não corrigidos neste gate. |
| `node --check scripts/test_gate_316_rpc_concurrency.mjs` | Passou. |
| `node --test scripts/cloud-audit/readonly-audit.test.mjs` | Primeiro revelou teste obsoleto que esperava 29 migrations; expectativa atualizada para o inventário local de 30. Reexecução: 19/19 passou. |
| E2E Playwright local | Primeira tentativa interrompida antes dos testes porque a porta padrão `9781` já estava ocupada por processo local preexistente (`EADDRINUSE`); não foi encerrado. Reexecução com `WORKER_HEALTH_PORT=19781`: **20/20 passaram** (desktop e mobile, 2,2 min). |
| `git diff --check` | Passou após ajuste da expectativa do manifesto. |

O teste Playwright usa a stack Supabase local e fixtures sintéticas; não utiliza Cloud nem publica no TikTok. O caso de “confirma publicação” valida apenas o fluxo local/simulado, não uma publicação TikTok real. O processo que ocupava 9781 foi preservado.

## Critérios GO/NO-GO

**GO para continuar revisão local:** 39 assertions concorrentes, pgTAP, Vitest, TypeScript e build aprovados; diff sem erros de whitespace.

**NO-GO para deploy/homologação Cloud neste gate:**

- Nove migrations não reconciliadas com o estado Cloud atual.
- Conteúdo de versões já registradas no ledger não foi comparado integralmente.
- `pg_net` permanece com exposição efetiva e caminho de chamada não verificados.
- RLS/Storage e permissões implantadas não foram exercitadas entre tenants em Cloud/staging.
- Migration 09 remove assinatura consumida por bundles antigos; precisa rollout transitório ou manutenção aprovada.
- Não há plano down universal; backups e restauração precisam de ensaio.
- Warnings do SQL lint permanecem e precisam de triagem, sem indicação neste teste de falha bloqueadora.

## Riscos residuais

1. **ALTO — compatibilidade da RPC em cache:** bundle antigo falha na resolução após remoção da assinatura antiga; bloqueia implantação isolada da 09.
2. **ALTO — ambiente Cloud desatualizado ou divergente:** inventário é histórico e igualdade de conteúdo SQL não foi comprovada.
3. **ALTO — Storage/pipeline:** migrations 03–08 mudam MIME, quarantine e gating; deploy de banco, Edge/worker e Storage precisa coordenação.
4. **ALTO — pg_net:** ACLs históricas amplas, alcance e principal efetivo não comprovados; exploração não demonstrada.
5. **MÉDIO — contenção concorrente além dos cenários:** harness valida interleavings específicos, sem teste de estresse multiusuário nem de rede durante commit.
6. **MÉDIO — `service_role`:** capacidade privilegiada depende de guarda adequada do segredo e de uso apenas em backend confiável; não verificada neste gate.
7. **MÉDIO — avisos do lint:** warnings locais requerem triagem; o lint com `--fail-on error` não reportou erros.

## Próximo Gate recomendado

Gate 3.16.1 local: resolver a estratégia compatível da assinatura RPC (stub antigo fail-closed ou manutenção), avaliar os warnings de lint sem mudanças especulativas, e repetir E2E após conclusão da execução atual. Depois, um gate separado deve aprovar a reconciliação read-only manual Cloud atualizada. A implantação requer revisão e autorização individual de migrations/hashes, staging compatível, backup/restore ensaiado e plano de rollout coordenado. Nenhuma autorização para Cloud decorre deste relatório.
