# Fase 3.6 — worker local e preparação para piloto

**Escopo:** execução local, sem Cloud, deploy, TikTok real, OAuth real, exclusão de mídia ou cobrança. **Classificação: PARCIALMENTE HOMOLOGADA.** O Compose real passou no smoke test; o serviço não foi instalado no host nem testado após reboot, e o ambiente disponível é Ubuntu 26.04.1, não Ubuntu 24.

## Arquitetura

Compose contém dois serviços sem socket Docker: `worker` (Node, saída para Supabase) e `validator` (FFprobe/FFmpeg, somente rede interna sem egress). Worker reclama itens por RPC PostgreSQL atômica com `FOR UPDATE SKIP LOCKED` e lease de 240 segundos. A validação encaminha bytes privados por HTTP autenticado dentro da bridge Docker marcada `internal`, usando token aleatório de pelo menos 32 bytes; não é TLS, pois o tráfego permanece no bridge local sem porta publicada. O serviço limita tamanho, decodifica no container sem rede, calcula SHA-256 no worker, promove com `upsert=false` e só então conclui a RPC com claim token. Falha de banco após promoção pode deixar objeto órfão, mas não aprova mídia; retry verifica o hash do objeto existente antes da conclusão. Quarentena só é removida após conclusão SQL.

O validador não recebe service role nem acesso de rede externo. A API HTTP só aceita POST `/validate` com token interno e GET `/live`; endpoint é acessível apenas na rede privada Compose. O container tem filesystem read-only, tmpfs efêmero, usuário `node`, sem capabilities e limites de CPU/memória/PIDs. MP4 H.264 (AAC opcional), JPEG, PNG e WebP são suportados; MOV/WebM permanecem recusados.

## Ubuntu e operação automática

Docker Engine/Compose foram verificados nesta máquina Ubuntu 26.04.1 LTS (não 24.04): daemon ativo/enabled; Docker 29.1.3, Compose 5.5.0. Compose declara 1 worker de vídeo; worker até 2 CPUs/2 GiB, validador 1 CPU/768 MiB; logs json 10 MiB × 3; sem portas públicas (health publicado somente em loopback `127.0.0.1:<porta>`). Dockerfile do validador usa base Node por digest e FFmpeg `8.1.3-r0`; imagem worker usa a mesma base digest e dependência `@supabase/supabase-js` fixada em 2.118.0.

Scripts `scripts/local-worker/{install,start,stop,restart,status,logs,systemd-start}.sh`. Instalador cria `.env` 0600 e user systemd unit idempotente quando as credenciais estão preenchidas; não chama sudo. O wrapper espera Docker por até 120 s antes de subir Compose. Para início antes do login, um administrador precisa decidir e executar `sudo systemctl enable --now docker` e `sudo loginctl enable-linger <usuário>`. Nesta homologação não instalamos nem habilitamos unit no host, nem escrevemos segredo local. Docker estava `enabled`; linger estava `no`. O serviço automático foi preparado, não habilitado empiricamente após reboot.

## Segredos e Cloud

`.env` é ignored e excluído do contexto raiz por `.dockerignore`; os Dockerfiles copiam somente manifests/scripts explicitamente. Compose monta arquivos de segredo read-only: validator recebe o token interno; worker recebe token e service role. Valores não são declarados em `environment`, argumentos ou imagem. Diretório local `secrets/` usa 0700 e arquivos 0600. A service role continua altamente privilegiada, portanto operação Cloud a partir de computador pessoal depende de postura de dispositivo, acesso e rotação. Não há credencial worker-scoped implementada.

`VIDEO_WORKER_ALLOW_CLOUD` padrão false. Worker rejeita hostname remoto sem opt-in explícito e rejeita URL remota sem HTTPS. Nenhuma URL Cloud, chave Cloud, tabela remota, migration ou objeto remoto foi consultado. As migrations locais 00001–00006 precisam de comparação aprovada com migration history Cloud antes de qualquer release. Não executar `db push` nesta fase.

## Claims, retry, heartbeats e falhas

Claims continuam usando as RPCs já existentes, não foi adicionada segunda fila. Uma lease única impede duplicação; timeout de validação de até 125 s fica abaixo do lease 240 s. Reinício do worker/container deixa lease expirar e claim torna o item recuperável. Falhas transitórias retornam para retry limitado a três tentativas com backoff da RPC; arquivo estruturalmente inválido fica REJECTED/FAILED. Falha de rede no polling mantém processo vivo, marca status local DEGRADED e tenta novamente (poll configurável, default 5 s). Um upload que chega com worker offline continua PENDING, sem rejeição por indisponibilidade.

Migration `20261103000006_video_worker_heartbeat.sql` adiciona tabela com RLS sem políticas cliente e RPC exclusivamente service-role. Ela registra UUID de instância, versão, online/degraded/stopping, heartbeat, pendente, em processamento, erros, média de duração e última conclusão. Heartbeat é renovado também durante trabalhos longos. Endpoint loopback `/live` mede processo; `/ready` exige contato Supabase e heartbeat bem-sucedido nos últimos 120 s. O worker não reivindica mais tarefas se não conseguir persistir telemetria (fail-closed). `status.sh` exibe ambos. Heartbeat operacional não equivale à saúde de publicação TikTok; publicador permanece separado.

Contadores de errors/completed/average são desde o boot do processo (não métricas financeiras nem contadores cumulativos), pending é snapshot global a cada heartbeat (~30 s e durante validação), processing é contador do processo. A tabela mantém IDs antigos para auditoria e não tem rotina de retenção implementada. Ainda falta UI administrativa; o acesso via loopback e tabela service-only foi escolhido para não expor telemetria global a workspaces comuns.

## Testes executados nesta fase

- Docker build do validator com Node base por digest e FFmpeg `8.1.3-r0`: passou.
- Docker build do worker Node sem Docker CLI/socket e com `npm ci` lockado: passou.
- Compose com Supabase **local**: passou; readiness e heartbeat na tabela local, fixture H.264/AAC aprovada (HTTP 200), bytes falsos/MIME forjado rejeitados (422), token interno incorreto rejeitado (401), restart recuperou `/ready`, stop gracioso encerrou ambos serviços.
- Smoke inspecionou usuário `node`, root filesystem read-only, `cap_drop=ALL`, limites de CPU/RAM/PIDs, rede validator `internal`, nenhuma porta para validator, porta worker em loopback e ausência de Docker socket.
- `docker compose config --quiet`: passou com env local temporário. Nenhuma tarefa existente estava pendente; smoke não processou job do banco.
- Benchmark `npm --prefix apps/web run benchmark:video-validator` (fixtures H.264 sintéticas 360×640/24 fps, sem áudio):

  | Duração | Tamanho | Geração | SHA-256 | FFprobe | Decode completo | Validação total | Pico CPU/RAM amostrado |
  |---:|---:|---:|---:|---:|---:|---:|---:|
  | 10 s | 1,30 MB | 280 ms | 10 ms | 80 ms | 228 ms | 987 ms | sem amostra confiável |
  | 30 s | 3,88 MB | 626 ms | 18 ms | 77 ms | 402 ms | 1.101 ms | sem amostra confiável |
  | 60 s | 7,75 MB | 1.295 ms | 30 ms | 72 ms | 769 ms | 1.418 ms | sem amostra confiável |
  | 180 s | 23,24 MB | 4.026 ms | 359 ms | 62 ms | 2.301 ms | 3.003 ms | 102,73% CPU; 52.156.170 bytes (~49,7 MiB) |

  As medições são deste host Ubuntu 26.04.1 em Docker, não são SLA nem medição de Storage/egress. Para clipes abaixo de 180 s, o processo terminou antes de uma amostra útil de `docker stats`; não extrapolamos pico. Download e promoção Supabase são `null`/não medidos por não usar Cloud. Geração da fixture não é parte da validação.
- Regressão final desta fase: `supabase db reset` passou com 26 migrations locais; pgTAP passou em 12 arquivos/165 testes; concorrência PostgreSQL passou; typecheck passou; Vitest 45/45; build passou; worker Vitest 28/28; Playwright 20/20 (desktop/mobile, 0 skips); backup/restore local passou; revalidação legada local passou; `npm audit --omit=dev` reportou 0 vulnerabilidades; Compose smoke passou; benchmark dos quatro comprimentos passou.
- Validação final desta continuação (2026-11-01): typecheck, Vitest **45/45**, build, worker **28/28**, `supabase db reset` (**26 migrations**), pgTAP **12 arquivos/165 testes**, concorrência, Playwright **20/20 (desktop/mobile, 0 skips)**, validador binário Docker, backup/restore PostgreSQL local, revalidação legada local, `npm audit --omit=dev` (**0 vulnerabilidades**) e `git diff --check`: aprovados. O teste de Compose foi executado com env e segredos temporários locais; heartbeat local foi persistido, MP4 H.264/AAC real aceito, MIME/conteúdo forjado rejeitado, token inválido rejeitado, restart/readiness e parada graciosa aprovados. Nenhuma tarefa pendente foi processada.

O backup/restore final criou um dump custom PostgreSQL de 559.921 bytes e o restaurou em banco local isolado (`autoclip_restore_531a11f6`): 2.279 ms totais, 991 ms para restore; workspaces, canais, grupos, mídia, lote, job, ciclo de quota e auditoria tinham uma linha cada, zero órfãos de FK e RPC presente. O relatório de backup ficou em `/tmp`; nenhum dump foi versionado.

O arquivo de unit systemd gerado foi validado por `systemd-analyze --user verify` (exit 0). A ferramenta também imprimiu um aviso não relacionado sobre a unit existente `spice-vdagent.service`; a unit AutoClipe verificou sem erro. A unit AutoClipe não foi instalada nem habilitada e o reboot não foi ensaiado, pois isso depende de configuração de sessão/linger no host.

Falhas transitórias observadas nesta continuação e corrigidas na execução: o smoke Compose sem arquivo `.env` terminou com `ENOENT`, pois o runner requer caminhos de segredos explícitos; uma execução posterior recebeu URL `host.docker.internal` também no processo host e falhou em `fetch`, então a configuração de entrada foi corrigida para loopback, mantendo a URL convertida para a rede Docker internamente. A checagem avulsa `docker compose config --quiet` sem variáveis obrigatórias foi rejeitada pelo próprio Compose; com o env temporário validado pelo smoke, a configuração passou. Nenhum segredo foi criado no worktree.

O teste final de revalidação legada passou em dry-run sem escrita e, na fixture local de aplicação, revalidou PNG e MP4 mantendo os mesmos IDs e preservando job, lote, histórico e reserva; a retomada foi explícita e não criou reserva duplicada. A suíte E2E percorreu os fluxos de biblioteca, grupos, prévia sem persistência, upload seguro, confirmação/repetição/reagendamento/cancelamento de lote, CSV de vídeo, sessão revogada e troca de workspace em desktop e mobile.

Um primeiro smoke falhou porque o Compose usava o contexto errado para o Dockerfile do sidecar; corrigido para `scripts/video-validator`. O seguinte ficou sem `/ready` porque o banco local ainda não tinha a migration de heartbeat; o worker não reivindicou mídia e permaneceu fail-closed. Esse teste também revelou parsing de timestamp ISO incorreto e parada SIGTERM demorada; ambos foram corrigidos. O smoke final após essas correções passou, incluindo parada graciosa.

## Backup e mídias legadas

O inventário `scripts/inventory_legacy_media.sql` é read-only. Dry-run de revalidação é padrão; `--apply-local --workspace UUID` continua limitado ao loopback. Revalidação valida bytes com o mesmo Docker sidecar (quando URL configurada em produção/piloto) e preserva ID, jobs, batches e reservas. Não retoma jobs automaticamente; o usuário/admin precisa acionar a RPC autorizada após validar mídia. Backup PostgreSQL não inclui objetos Storage. Exija backup/recuperação separada de objetos antes de qualquer rollout.

## Checklist remoto futuro (não executado)

1. Aprovação explícita da janela e do projeto Cloud.
2. Confirmar projeto/ref e schema/migration history com operador autorizado; comparar e aplicar migrations em mudança separada revisada.
3. Backup PostgreSQL e Storage, seguido de restore ensaiado.
4. Inventário read-only de mídias, jobs, lotes, reservations, tokens/expiry e bucket; estimar jobs bloqueados.
5. Aprovar decisão sobre chave service role em host pessoal. Não conectar worker até política de segredo/dispositivo/rotação definida.
6. Provisionar e monitorar runtime, egress HTTPS e limites, manter uma instância de validação.
7. Ativar worker apenas após migrations/Edge compatíveis; processar fixture autorizada sem publicar.
8. Verificar heartbeat, claims, hash e Storage; então piloto gradual.
9. Para interromper: parar claims/container, deixar leases expirarem, não deletar objetos nem liberar quota, reconciliar estados e só corrigir forward/restaurar DB+Storage coordenadamente.

## Portabilidade e riscos

O compose não usa paths pessoais, GUI, host Docker socket ou volumes de aplicação. Para VPS, provisionar Docker, copiar config sem secrets, gerar novo instance UUID/token, provisionar key pelo secret store escolhido egress restrito, subir, validar health/heartbeat e somente então parar host local. Não executar dois workers de revalidação legada para mesmo item; claim ainda serializa.

**Bloqueios para piloto Cloud:** esta fase não tem E2E Cloud, não cria credencial restrita de worker, não provou boot com linger nesta máquina e o host não é Ubuntu 24. A URL/key Cloud, RLS/bucket remotos e ledger migrations não foram consultados. Computador local offline pausa validações. Vercel/Supabase planos e permissões TikTok precisam revisão comercial/política fora do escopo. A implantação não está autorizada.

## Addendum Fase 3.6.1 (2026-11-01)

O worker residente foi atualizado para autenticar exclusivamente na Edge Function `video-worker-api` com credencial HMAC dedicada, timestamp e nonce de uso único; a service role não é montada nem fornecida ao container. A service role fica somente no runtime Edge confiável. Veja `PHASE_3_6_1_LOCAL_WORKER_SECURITY_AND_AUTOSTART.md` para o modelo e resultados.

O Ubuntu atual foi verificado como 26.04.1 LTS, Docker 29.1.3, Compose 5.5.0 e systemd 259. O instalador local foi executado sem sudo; as duas units de usuário foram instaladas/habilitadas e estavam ativas. `linger=no` e nenhum reboot foi realizado: não declarar início antes do login após boot. Não houve alterações de energia/suspensão.

A execução integrada de um MP4 real no Compose concluiu `READY/VALIDATED`, SHA-256 verificado, atestação FFmpeg, quarentena removida e HMAC/replay testados. O smoke Compose também passou restart/readiness/parada. Uma corrida de upload foi encontrada no E2E e corrigida na migration local `20261103000008_gate_video_validation_on_storage_upload.sql`: claim só é elegível depois de a Edge Function encontrar e conferir o objeto de Storage persistido. Reset local com 27 migrations, pgTAP 14 arquivos/181 testes, concorrência e E2E 20/20 desktop/mobile passaram. A revalidação legada foi adaptada a um utilitário one-shot local separado; ele usa credencial local apenas durante uma operação administrativa explícita, nunca no serviço residente.

Permanecem pendentes: boot efetivo com linger após autorização administrativa, teste de resiliência/concorrência entre duas instâncias Compose, UI administrativa do heartbeat, backup/restore após a migration 00008 e qualquer auditoria/ativação Cloud (proibida nesta fase). O ensaio de backup antes da nova migration passou; o próximo ensaio atualizado está pendente.
