# AutoClipe — auditoria de segurança local

**Data:** 2026-11-01
**Alcance:** migrations aplicadas no Supabase local, RPCs de lote, Storage, OAuth e validações do worker. Sem acesso remoto, teste de penetração ou publicação.

## Resultados verificados

### RLS e workspace

Após `supabase db reset`, consultamos `pg_class`, `pg_policies` e permissões no banco local. RLS está habilitada nas relações críticas verificadas: `workspaces`, `workspace_members`, `channels`, `oauth_connections`, `account_groups`, `account_group_members`, `media_assets`, `publication_jobs`, `publication_batches`, `publication_batch_operations`, `publication_quota_reservations`, `audit_logs` e `storage.objects`.

As tabelas de grupos usam `private.is_member` para leitura e `private.can_edit` para escrita. A associação grupo/canal usa FKs compostas com `workspace_id`, que rejeitam ligações entre workspaces. As RPCs de lote validam membership ou papel de edição com o workspace recebido e restringem as queries pelos IDs e workspace. A suíte pgTAP inclui isolamento de workspace. `oauth_connections` tem RLS ativa sem política para clientes: verificações locais retornaram `false` para `SELECT` de `anon` e `authenticated`, e `true` somente para `service_role`.

### RPCs

As funções `confirm_publication_batch`, `cancel_publication_batch_items`, `reschedule_publication_batch_items` e `list_publication_batches` são `SECURITY DEFINER`, usam `search_path=""`, não permitem `anon` e concedem `EXECUTE` a `authenticated` e `service_role`. Internamente confirmam usuário e workspace; as mutações também exigem permissão de edição. A consulta paginada exige membership.

A auditoria encontrou a corrida de confirmação com a mesma chave de idempotência. A migration local agora serializa confirmações por lock advisory antes da consulta de idempotência. A concorrência com duas conexões comprovou duas respostas bem-sucedidas e somente um job. A validação total continua no PostgreSQL e quotas são aplicadas pelos triggers/transações existentes.

### OAuth e tokens

- `oauth_states` tem RLS sem policy de cliente; `create_oauth_state` exige autorização de canal e cria state aleatório de uso único com expiração de 10 minutos. `consume_oauth_state` é executada somente por `service_role` e remove o state antes de devolver contexto.
- Tokens são cifrados com AES-256-GCM; o ID do canal é usado como AAD, impedindo copiar um ciphertext entre canais. O runtime exige a chave de 32 bytes via secret `TOKEN_ENCRYPTION_KEY`.
- O callback não grava os tokens no navegador; o cliente de service role permanece server-side. A inspeção de ocorrências de token nos handlers encontrou persistência cifrada e passagem interna ao worker; não foi feita validação contra logs históricos remotos.
- Os testes do worker cobrem renovação, token expirado/revogado, ausência de escopo e bloqueio sem chamada TikTok quando conexão/permissão falha.

### Storage

Consulta local confirmou bucket `media` com `public=false`, limite local de 50 MiB e allowlist para MP4, QuickTime, WebM, JPEG, PNG e WebP, alinhada aos tipos da biblioteca. A migration local `20261103000003_allow_image_media_uploads.sql` corrige a configuração inicial que bloqueava os três tipos de imagem no upload. As policies permitem leitura por membro, escrita por editor e exclusão de objetos por administrador; existe regra adicional limitada a upload próprio órfão. Os nomes de objeto precisam começar pelo UUID do workspace. O tamanho máximo global do bucket é 50 MiB; a UI limita imagens a 20 MiB e vídeos a 50 MiB. Não foram enviados binários na auditoria.

A verificação é por MIME declarado e tamanho no cliente/bucket; não é inspeção de assinatura binária, codec ou conteúdo malicioso. Essa validação profunda permanece pendente antes de aceitar uploads não confiáveis em operação comercial. Não foram geradas URLs assinadas nem tentado acesso a objetos reais nesta auditoria.

### Workers

`publication-worker` e `media-cleanup` desabilitam a verificação JWT do gateway, mas verificam `x-worker-secret` com comparação em tempo constante. A rotina de jobs usa locks, idempotência e reconciliação; 25 testes de worker passaram. A função de limpeza permaneceu sem exclusão física e não houve invocação remota.

### Dependências

`npm audit` reportou **0 vulnerabilidades** no lockfile npm. Não há auditoria de dependências Deno/JSR no repositório; esse ecossistema precisa de verificação própria no pipeline de release.

## Limitações e riscos restantes

- A consulta foi restrita ao schema e ao banco local; não comprova configuração de RLS, grants, secrets, logs ou cron no projeto remoto.
- Functions com `verify_jwt=false` dependem da disponibilidade, rotação sincronizada e sigilo de `WORKER_SECRET`; ao rotacionar, atualizar o agendador e os chamadores no mesmo plano de mudança.
- Revisão de código não substitui teste de penetração, revisão independente, verificação de configuração Vercel/Supabase, nem análise dinâmica de endpoints OAuth.
- `npm audit` não examina código de terceiros carregado pelo TikTok nem dependências importadas diretamente do registry JSR.
- Não houve acesso autenticado com dois workspaces em navegador. O isolamento foi coberto por testes pgTAP/RPC.

## Adendo Fase 3.5.1 — validação de mídia

A migration local `20261103000004_secure_media_validation_pipeline.sql` fecha a gravação direta no bucket final e exige `READY/VALIDATED` com atestado server-side para agendamento. Upload novo vai ao bucket privado de quarentena; a Edge Function `media-validate` verifica Auth, papel, workspace, caminho, tamanho e bytes reais de JPEG/PNG/WebP usando decodificadores WASM; só então grava o objeto final imutável e atesta SHA-256, MIME detectado, tamanho e versão. O worker confere SHA-256 e tamanho do objeto antes de iniciar publicação. As chamadas RPC de promoção/rejeição estão restritas a `service_role` e usam `search_path` vazio.

**Risco/bloqueio:** o runtime Edge atual não dispõe de decodificador de vídeo confiável. MP4/MOV/WebM falham fechado, e a interface bloqueia novos uploads de vídeo. Mídias preexistentes foram marcadas `UNVERIFIED`; não podem ser agendadas nem processadas. Antes de qualquer aplicação remota, é obrigatório planejar revalidação/recarga dessas mídias e tratar jobs previamente agendados. A migration ainda não foi aplicada remotamente. Consultar `docs/PHASE_3_5_1_STORAGE_HARDENING_AND_E2E.md` para resultados dos testes desta fase.

## Classificação

| Área | Estado |
|---|---|
| RLS e isolamento das tabelas auditadas | Verificado localmente; pgTAP aprovado |
| RPCs de lote e `search_path` | Verificado localmente; grants e testes aprovados |
| Race de idempotência em confirmação | Corrigida localmente; teste de duas conexões aprovado |
| Criptografia e fluxo de tokens no código | Revisado; cenários de worker aprovados |
| Storage privado e policies | Verificado no schema local; acesso visual não exercitado |
| Allowlist de imagens no bucket | Corrigida em migration local e coberta por pgTAP; upload binário ainda pendente |
| Workers | Testes unitários aprovados; invocação de produção não realizada |
| Dependências npm | `npm audit`: 0 vulnerabilidades |
| Dependências Deno/JSR e pentest | Pendente |

## Adendo Fase 3.6 — worker local (somente Supabase local)

O worker e o validador rodam em serviços Compose separados. O worker detém a service role via Docker secret de arquivo local, ignorado pelo Git, e faz saída HTTPS. O validador recebe apenas token interno + bytes, está em rede Compose `internal` sem egress, sem porta publicada, como `node`, read-only, sem capabilities e com limite de recurso. `/live` mede processo; `/ready` exige sucesso recente de comunicação **e** persistência de heartbeat service-only. A RPC heartbeat e a tabela têm `search_path` vazio, RLS sem policy cliente e grants apenas para `service_role`.

O smoke local verificou que service role/token não aparecem no `Config.Env`, não há Docker socket, o validador não recebeu qualquer configuração Supabase, token interno incorreto foi rejeitado, H.264 válido passou e bytes falsos foram rejeitados. O worker não reclama jobs sem heartbeat operacional; leases recuperam claims expirados. Não houve inspeção de Cloud, rotação de segredo remoto, teste de penetração nem validação de boot real.

**Risco residual alto para Cloud:** a service role continua ampla e é necessária às RPCs/Storage atuais. Se o PC for comprometido, o escopo potencial supera apenas validação de vídeo. Antes de piloto Cloud, aprovar secret custody, proteção de disco/usuário, acesso físico, rotação e alternativa de credencial worker-scoped. Worker e validator compartilham a mesma máquina; `internal` impede egress do validador, mas não protege contra comprometimento do host/root.


## Registro histórico da Fase 3.5 — validação de Storage local

Playwright autenticado contra o Supabase local confirmou que o bucket `media` é privado: download autenticado funciona, endpoint público não serve objeto, e membro de outro workspace não consegue emitir signed URL. Uploads locais de JPEG, PNG, WebP e MP4 foram aceitos; MIME não permitido, upload anônimo, sobrescrita sem `upsert` e tamanho acima de 50 MiB foram rejeitados.

**Risco encontrado (integridade de uploads):** Storage aceita bytes de texto quando o cliente declara `image/png`. A UI decodifica a imagem e verifica dimensões, mas essa validação ocorre no browser e é contornável por chamadas diretas autenticadas ao Storage/`finalize_media`. O bucket compara MIME declarado e tamanho, não prova assinatura/codec. Antes de permitir upload não confiável em operação, adicionar validação confiável no backend e um teste negativo por assinatura. Até lá, classificar como limitação residual de integridade de mídia; não anunciar validação binária server-side.

O runner E2E usa service role somente para preparar/limpar dados fictícios após validar hosts locais. A chave não é enviada ao browser nem gravada. Nenhuma vulnerabilidade de dependência de produção foi reportada por `npm audit --omit=dev` na linha de base da Fase 3.4; a auditoria será repetida na validação final desta fase.

**Estado posterior:** este registro descreve a limitação encontrada na Fase 3.5; o pipeline local de vídeo e as correções estão documentados no Adendo Fase 3.5.2 acima.
## Adendo Fase 3.5.2 — validação de vídeo e mídia legada

Migration local `20261103000005_video_validation_and_legacy_revalidation.sql` adiciona validação assíncrona service-only com lease, claim concorrente, validação de MP4 em worker Docker local, atestado SHA-256/MIME/tamanho/codec e promoção sem overwrite. O runtime Edge não executa ffmpeg. MP4/H.264 é validado por FFprobe e decodificação integral FFmpeg sob isolamento de recursos; MOV/WebM continuam rejeitados. Upload não significa aprovação. Agendamentos e worker exigem `READY/VALIDATED` e H.264 detectado.

Testes locais reais incluem MP4, JPEG, PNG e WebP, bytes falsos/truncados, codec não suportado, duração/resolução além dos limites, hash final e autorização Storage. Um teste de revalidação antiga verificou dry-run inalterado e atualização do mesmo asset sem tocar no job, lote ou reserva; retomada de job é uma ação RPC explícita. Inventário read-only em `scripts/inventory_legacy_media.sql` foi corrigido para agregar por mídia antes de agrupar.

**Limitação operacional:** Vercel + Supabase não disponibilizam automaticamente worker Docker persistente. A adoção de vídeo fora de ambiente local está bloqueada até provisionar runtime seguro compatível, segredos, limites/escala e monitoramento. Nenhuma alteração remota foi executada.
# Addendum — worker local Fase 3.6.1

O worker residente não recebe mais `service_role`. Ele usa HMAC com rota fixa, timestamp de curta janela, nonce consumido atomicamente e corpo assinado; o gateway só expõe ações delimitadas de validação. A chave de atestação permanece apenas na Edge Function e no container de validador isolado; a Edge verifica os bytes armazenados antes da promoção. Chaves locais são arquivos ignorados (0600; diretório 0700), montados read-only, e não fazem parte da imagem. Rotação/revogação ainda depende de operação local coordenada entre segredo API/attestation e reinício dos serviços.

A migration `20261103000007_video_worker_api_credentials.sql` protege nonce/leases; `20261103000008_gate_video_validation_on_storage_upload.sql` protege o estado `upload_completed_at` e evita claim enquanto o upload ainda não persistiu. pgTAP comprova execução server-only, rejeição de marker sem objeto/tamanho correto e claim somente após gate. Não foi acessado Supabase remoto.

Limite de confiança: usuário/host Docker local, runtime Edge com service role e processo FFmpeg continuam confiáveis. Uma chave HMAC roubada pode executar as operações estreitas da API até rotação; ela não equivale a isolamento criptográfico do host. A API refaz download/hash, mas validação da decodificação depende da atestação do container no host autorizado. Não habilitar endpoint Cloud sem review de secret store, TLS, rotação e autorização específica.
# Aditivo da Fase 3.6.2 — limite de evidência Cloud

Esta fase inspecionou somente a fonte local e executou testes locais. Nenhuma conexão Supabase Cloud/Vercel foi feita. RLS, grants, buckets, Edge Functions implantadas, Auth, jobs e credenciais remotos permanecem **não verificados**; não classificar os controles locais como prova da configuração Cloud.

Foi criada `scripts/cloud-audit/readonly-audit.mjs`, sem leitura automática de `.env`, com alvo explícito, flags de confirmação, host TLS restrito, transação read-only, queries estáticas, limites de timeout e recusa de roles com escrita/DDL ou privilégios administrativos. A conexão ainda depende de confirmação explícita do proprietário e credencial com acesso de leitura efetivamente restrito. Um token de Supabase Management API não deve ser considerado read-only apenas porque a operação é GET.

As pendências operacionais da Fase 3.6.1 seguem: `linger`/boot pré-login sem comprovação, concorrência de duas instâncias Compose não testada e falhas intermediárias durante promoção ainda não totalmente exercitadas.

> **Correções de histórico:** a nota anterior que descreve vídeo temporariamente bloqueado por indisponibilidade de FFmpeg representa o estado anterior à Fase 3.5.2. MP4/H.264 passou a ser validado por worker Docker local; MOV/WebM continuam bloqueados. A nota da Fase 3.6.1 supersede a descrição antiga de `service_role` no worker: o container residente usa HMAC específico e a chave service-role não é montada nele. Nenhuma dessas verificações locais prova o estado Cloud.
