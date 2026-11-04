# Fase 3.6.1 — segurança e inicialização do worker local

**Classificação atual: PARCIALMENTE HOMOLOGADA.** O teste Compose de uma tarefa real, autenticação HMAC local, regressão SQL e Playwright desktop/mobile passaram. O boot sem login continua pendente porque `linger` está desabilitado e não foi feito reboot. Nenhuma conexão Cloud foi tentada.

## Ambiente efetivamente verificado

- Host: Ubuntu 26.04.1 LTS; kernel registrado pelo host durante esta execução.
- Docker 29.1.3 e Compose 5.5.0; daemon `enabled` e `active`.
- systemd 259.
- Units de usuário `autoclip-video-worker-api.service` e `autoclip-local-worker.service`: instaladas, habilitadas e ativas na sessão corrente. `systemd-analyze --user verify` passou.
- `loginctl show-user ... Linger`: `no`. Portanto não se declara início antes do login/reboot homologado. Um administrador pode aprovar `sudo loginctl enable-linger diogo-nascimento`; isso não foi executado.
- Nenhuma configuração de suspensão, tampa, bloqueio de tela, firewall ou energia foi alterada.

## Identidade e fronteira de confiança

O container do worker não recebe `SUPABASE_SERVICE_ROLE_KEY`, não lê tabelas diretamente e não tem permissão ampla no Storage. Ele assina cada operação autorizada para `video-worker-api` com HMAC-SHA256; o canonical request liga método, rota fixa, timestamp, nonce e hash do corpo. A Edge Function rejeita assinatura/horário inválidos e nonce repetido e oferece somente heartbeat, claim, conclusão, rejeição ou retry de validação. A identidade é uma credencial compartilhada específica do worker, diferente da service role, com escopo limitado por código da API. Não é uma credencial SQL nem autenticação Supabase REST.

A Edge Function confiável mantém a service role apenas no runtime Supabase local/Edge e executa RPCs estreitas. Rotação/revogação local: substituir `deploy/local-worker/secrets/video_worker_api_secret`, atualizar `.edge.env` atomicamente com o mesmo valor, reiniciar API e worker; para revogar, gerar valor novo antes de retomar polling. Em Cloud, a rotação exige instalação autorizada do segredo Edge e reinício controlado do worker. Segredos locais ficam em arquivos 0600 sob diretório 0700, ignorados pelo Git; `.env`/`.edge.env` não são imagem nem contexto Docker.

O validador recebe somente token interno e chave de atestação dentro da rede Compose `internal`; o worker não lê a chave de atestação. A atestação associa media ID, claim/fencing token, hash e tamanho. Na conclusão, a Edge baixa novamente o objeto privado e verifica os bytes contra a atestação antes da promoção. O lease expirado não pode ser concluído/rejeitado/liberado. O destino final é promovido sem overwrite e o estado só muda após conferência.

## Corrida de upload encontrada e corrigida

O primeiro E2E completo desta continuação observou que `begin_media_upload` cria a linha PENDING antes de o cliente terminar o upload. O worker podia reivindicá-la nesse intervalo e a política Storage negava corretamente a gravação. O problema não foi contornado abrindo RLS.

A migration local `20261103000008_gate_video_validation_on_storage_upload.sql` adiciona `upload_completed_at` protegido contra escrita do cliente, RPC service-role-only que exige o objeto de quarentena persistido e tamanho compatível com Storage, e condição de claim que só aceita uploads concluídos. `media-validate` registra a conclusão depois de baixar/conferir o objeto. Upload sem validação iniciada fica pendente; não se rejeita apenas por worker offline.

## Testes e evidências desta execução

- Compose smoke: builds fixados; validator e worker `node`, rootfs read-only, `cap_drop=ALL`, recursos limitados, sem Docker socket; validator sem porta no host, health do worker em loopback; heartbeat persistido; token interno inválido recusado; MP4 H.264/AAC real validado pelo sidecar; bytes falsos rejeitados 422; restart e parada graciosa aprovados. O teste não consome dados de outros projetos.
- Compose end-to-end: MP4 H.264/AAC de fixture criado localmente, carregado em quarentena local, reivindicado pelo Compose, decodificado por FFmpeg, atestado, promovido e validado pelo SHA-256 dos bytes baixados. Resultado registrado: 61.982 bytes, hash `5fefd65f5a83807b9ac78bc7b64ae10e50e94de15cf374b77c74e8b3e30f3d4b`, `READY/VALIDATED`, objeto de quarentena removido, container sem service role. Autenticação HMAC aceitou heartbeat válido e rejeitou ausente/expirada/replay.
- Após migration 00008: `supabase db reset` local passou com 27 migrations; pgTAP 14 arquivos/181 testes; concorrência passou.
- Playwright local autenticado: 20/20, desktop Chromium e mobile 390×844. Inclui Storage, lote, CSV de vídeo, repetição, cancelamento, reagendamento, sessão revogada e troca de workspace. A primeira execução teve 1 falha de RLS por corrida do upload, depois corrigida; a repetição com a migration passou 20/20.
- Vitest 45/45, worker 28/28, typecheck, build e `npm audit --omit=dev` (0 vulnerabilidades) passaram nesta execução.
- Backup/restore depois da migration 00008 passou em PostgreSQL local. Dump custom de 566.921 bytes (pg_dump 17.6), restore em DB isolado em 972 ms; duração total 1.896 ms; 1 workspace/channel/group/media/batch/job/quota-cycle/audit, zero órfãos de FK e RPC presente.
- Revalidação legada: dry-run sem mudanças e aplicação local explícita passaram para MP4 e PNG; IDs, job, lote, histórico e reserva preservados; retomada por ação explícita sem reserva duplicada. O caminho administrativo foi separado do daemon e usa service role local somente na execução one-shot com workspace explícito; worker residente segue sem service role.
- Falhas intermediárias: E2E primeiro reproduziu a corrida de claim antes do fim do upload; após o gate 00008, desktop/mobile passou 20/20. O primeiro teste de tarefa Compose após adicionar o gate expirou porque seu fixture ainda não invocava `media-validate`; o runner foi corrigido para registrar o upload e a execução real passou.

## Inicialização e operação

`scripts/local-worker/install.sh` foi executado sem sudo e criou/enabled units de usuário. Compose usa restart policy. Para conferir: `scripts/local-worker/status.sh`; logs: `scripts/local-worker/logs.sh`. O serviço não depende de terminal gráfico, mas sem linger uma unit de usuário não garante start pré-login. Docker já estava enabled/active pelo host. A validação da unit não substitui teste após reboot.

Para habilitar execução antes do login, aprovação administrativa necessária:

```bash
sudo loginctl enable-linger diogo-nascimento
loginctl show-user diogo-nascimento -p Linger
```

Depois, reiniciar o host em janela autorizada e confirmar `systemctl --user is-active autoclip-video-worker-api autoclip-local-worker`, Compose health e heartbeat recente. Isso não foi executado. Suspensão automática continua conforme configuração existente; worker offline mantém arquivos em espera, mas interrompe a validação local até retorno do host.

## Monitoramento e limites

`/live` e `/ready` estão publicados apenas em `127.0.0.1`; `/ready` exige sucesso recente de API e heartbeat. `status.sh` apresenta backend, heartbeat, fila/contadores e versão. A tabela `media_validation_workers` permanece service-only. Não foi criado painel global no frontend: expor heartbeat/fila de workers a todos os workspaces violaria o isolamento. A UI do usuário continua mostrando estados de mídia; painel administrativo restrito é uma pendência para fase de observabilidade.

## Limitações e pendências

- Não houve reboot; `linger=no`; início antes do login não aprovado.
- O smoke de Compose não publica e não testa TikTok. Worker de publicação permanece separado e depende da infraestrutura já existente; indisponibilidade local afeta somente validação de vídeo.
- Nenhum endpoint, secret, migration, bucket ou Storage Cloud foi acessado. A credencial HMAC está preparada apenas para Supabase local; não habilitar `VIDEO_WORKER_ALLOW_CLOUD` sem revisão autorizada e TLS.
- O host pessoal, queda de energia/rede e suspensão são riscos operacionais; sem worker local, uploads de vídeo ficam pendentes. Não é SLA nem redundância.
- Não foi executado ensaio de interrupção em cada fase de promoção nem concorrência de duas instâncias Compose nesta execução; leases e teste PostgreSQL de concorrência cobrem exclusividade/recuperação, mas não substituem esses ensaios de caos.
- A API valida a atestação emitida pelo container FFmpeg e rebaixa os bytes na Edge. O host do desenvolvedor e Docker continuam parte do TCB durante validação local.

## Próxima etapa

Antes da Fase 3.6.2: decidir/autorização para `linger` e reboot; reexecutar status/heartbeat após boot; concluir teste de interrupção em promoção e duas instâncias; revisar projeto Cloud, migration history e secrets apenas mediante autorização separada. Não conectar produção automaticamente.
