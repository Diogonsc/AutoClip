# Worker local de validação AutoClip

Topologia Compose destinada a Ubuntu 24 e futura migração para uma VPS. O smoke foi executado neste host Ubuntu 26.04.1, portanto Ubuntu 24 ainda precisa de validação. `worker` mantém a conexão HTTPS de saída com Supabase; `validator` é um serviço separado, privado, sem egress, sem portas publicadas e limitado a decodificação FFmpeg. O worker encaminha os bytes ao validador por HTTP na bridge Docker marcada `internal`, autenticado por token aleatório. Nenhum serviço monta o Docker socket.

## Requisitos

- Docker Engine ativo para o usuário atual e plugin Docker Compose v2.
- Ubuntu 24 x86_64, recomendado SSD e 16 GB RAM. Configuração aplicada: uma validação simultânea; worker limitado a 2 CPUs/2 GiB, validador 1 CPU/768 MiB, `pids_limit`, tmpfs, filesystem read-only, `cap_drop: ALL`, `no-new-privileges`, logs de 10 MiB × 3. Os limites são tetos iniciais, não uma promessa de throughput.
- A imagem do validador usa digest da base Node e FFmpeg Alpine `8.1.3-r0`; reconstrua e revise a versão ao atualizar.
- Supabase API alcançável por HTTPS de saída. Para local, `http://host.docker.internal:54321` é resolvido via host-gateway.

## Preparação

Na raiz do repositório:

```bash
bash scripts/local-worker/install.sh
```

Na primeira execução, o instalador cria `deploy/local-worker/.env` com mode `0600`, arquivos `secrets/` com mode `0600`, gera o ID da instância e token interno aleatório, e para para que o operador preencha o arquivo `secrets/supabase_service_role_key`. Para teste local, use exclusivamente a chave `SERVICE_ROLE_KEY` que o comando `supabase status --output env` exibe para o stack local; não imprima a saída desse comando em logs. Não copie chave de produção para esta máquina nesta fase.

Depois de editar o arquivo:

```bash
bash scripts/local-worker/install.sh
bash scripts/local-worker/status.sh
bash scripts/local-worker/logs.sh
bash scripts/local-worker/restart.sh
bash scripts/local-worker/stop.sh
```

`.env` e `secrets/` são ignorados pelo Git e excluídos do build context; não passe segredos como argumentos de linha de comando, não use prefixos `VITE_` e não inclua-os em backups compartilhados. Compose monta as chaves como secrets de arquivo, não em variáveis container nem imagem. O worker usa a chave `service_role` porque as RPCs de claim/storage são service-only. Ela é altamente privilegiada: neste desenho fica apenas no processo confiável do worker no Ubuntu; o validador isolado recebe somente o token interno e bytes, nunca credencial Supabase. Rotacione-a se a máquina for comprometida. A integração Cloud não foi habilitada nem testada nesta fase.

## Inicialização após reboot

O instalador cria e habilita `systemd --user` unit local, sem `sudo`. O Docker Engine precisa estar habilitado no boot. Para iniciar antes de login de usuário, um administrador deve executar manualmente, depois de revisar a política local:

```bash
sudo systemctl enable --now docker
sudo loginctl enable-linger "$USER"
```

Esses comandos não são executados pelo instalador. `restart: unless-stopped` recupera containers quando o daemon volta; leases PostgreSQL recuperam claims vencidos. A validação interrompida nunca marca mídia como aprovada. `stop.sh` para os containers sem apagar volumes ou registros.

## Health e diagnóstico

- `docker compose ps`/`status.sh`: processo, estado e healthcheck.
- `http://127.0.0.1:9781/live`: processo Node vivo.
- `http://127.0.0.1:9781/ready`: houve contato Supabase bem-sucedido nos últimos 120 s; resposta 503 indica vivo porém sem prontidão.
- `/ready` também mostra contadores aproximados do processo, última conclusão, média de duração desde o início, versão e ID aleatório da instância. Não contém segredo nem conteúdo de mídia.
- A RPC `media_validation_worker_heartbeat` persiste versão, estado, última batida, pendentes, processando, erros e média, mas a tabela é inacessível a clientes comuns. IDs de instâncias antigas não são limpos automaticamente.
- `logs.sh` mostra logs estruturados; `FOLLOW=true bash scripts/local-worker/logs.sh` acompanha. Os erros incluem códigos allowlisted e IDs de mídia/workspace, nunca tokens.

Um heartbeat recente não prova que todos os fluxos de publicação estão saudáveis. A falha do worker local mantém vídeos em `PENDING`/`VALIDATING`; publicação TikTok continua em workers separados. O worker local não publica vídeos.

## Supabase Cloud — preparação, não habilitada

O worker aceita uma URL não local somente com `VIDEO_WORKER_ALLOW_CLOUD=true` e HTTPS. Isso é um opt-in perigoso, não foi usado/testado aqui e não deve ser habilitado antes de aprovação operacional. Nunca rode comandos do worker contra Cloud sem autorização e janela aprovada. Antes: conferir projeto e migration history remotamente por operador autorizado; avaliar RLS, bucket, grants, Edge Functions, filas, jobs/quota e Storage legado; backup de PostgreSQL **e** cópia/recuperação independente dos objetos; ensaio de restore; revisão do service role; firewall/egress; uma instância piloto; reconciliação; smoke sem publicar; plano de pausa/rollback. Não aplicar migrations automaticamente pelo instalador.

Antes de usar Cloud, decidir se a chave service role pode permanecer neste computador. Preferência futura: credencial dedicada de worker/API server-side com operações restritas; a chave service role atual não tem escopo limitado por workspace. Não guarde-a em `.env` compartilhado, repositório, Vercel ou imagem.

## Migração futura para Hetzner/VPS

Copiar o repositório/versão aprovada e Compose, provisionar Docker com usuário não-root e política de atualizações, recriar `.env` de forma segura na VPS (não copiar secrets em texto), gerar novo instance UUID e novo token interno, definir URL HTTPS, instalar/habilitar systemd e conferir `/live`, `/ready`, heartbeat e uma fixture aprovada. Só então parar o worker local. O claim/lease impede dois workers de obterem o mesmo job; durante a migração acompanhe leases antigas e não manipule jobs diretamente.

## Testes locais

```bash
docker compose --project-directory deploy/local-worker -f deploy/local-worker/compose.yaml config --quiet
docker build -t autoclip-video-validator:3.6.0 -f scripts/video-validator/Dockerfile scripts/video-validator
docker build -t autoclip-video-worker:3.6.0 -f deploy/local-worker/Dockerfile .
npm --prefix apps/web run test:worker-compose
```

Os testes de claims/lease/concorrência e mídia seguem os scripts Supabase local documentados em `docs/PHASE_3_6_LOCAL_WORKER_AND_PILOT_READINESS.md`. Não use `docker compose down -v`: nenhum volume deve ser removido como parte da operação normal.
