# AutoClipe — Gate 3.19.4: preparação operacional para Staging e Production

**Data:** 2026-11-04
**Escopo:** preparação local, auditoria do código e validações locais. Nenhuma conexão, escrita, migration ou implantação remota foi executada.

## Parecer

**Staging: NO-GO. Production: NO-GO.** O gate remove o bloqueio local de Deno, mas não comprova recuperação integral, não prova o drain das instâncias Edge antigas e não demonstra que TikTok Shop está funcionalmente bloqueado.

| Item | Estado | Evidência / limite |
|---|---|---|
| Deno nas cinco Edge Functions | PASS local | Deno 2.9.8 / TypeScript 6.0.3; comando pedido terminou com exit 0. |
| Testes de mídia/callback/Db | PASS local | Deno 38/38; PNG sintética subarray, assinatura HMAC, callback e atualização de estado cobertos. |
| Testes de rotação OAuth | PASS local | Bun 12/12; testes sintéticos, sem API TikTok real. |
| M10/M11 | PASS integridade local | Hashes continuam `9b14ae…a38845` e `61aaee…3659f`; testes locais anteriores permanecem limitados a Postgres descartável. |
| Backup PostgreSQL e Storage | PASS reportado / não revalidado neste gate | O contexto do proprietário informa arquivos existentes com SHA-256 validado. Não localizei nem reabri os artefatos nesta execução. |
| Restauração integral | **BLOCKED** | Nenhuma restauração completa PostgreSQL + objetos Storage executada com sucesso. Ensaios anteriores falharam em alvos incompatíveis (`pg_cron` e objetos herdados de Realtime). |
| Drain de escritores antigos | **BLOCKED** | O código local mostra escritores/consumidores; não há prova de inventário/deploy/drain em Cloud. |
| TikTok Shop desativado no pacote | **BLOCKED** | Há rota/menu, campos do worker e Edge Functions Shop. M10/M11 também alteram tabela e RPCs Shop. “Inativo em Production” não comprova bloqueio do release. |
| Auditoria remota de RPC/RLS/Storage | Pendente | Consultas SELECT-only preparadas; não executadas. |

## Causa e decisão operacional

1. **M10 e M11 devem ser aplicadas consecutivamente, com todos os escritores antigos pausados.** M10 adiciona lease/versionamento a `oauth_connections` e `tiktok_shop_connections`; M11 faz a aquisição falhar de forma conservadora quando a expiração do refresh token é desconhecida. A janela entre M10 e M11 não pode ter workers ativos.
2. Os principais caminhos locais de refresh são `publication-worker` e `tiktok-channel` (Login Kit), e `tiktok-shop`/`tiktok-shop-publish` (Shop). Os callbacks OAuth salvam novas credenciais e também precisam ser suspensos durante o corte de schema. Ver [inventário e plano de manutenção](GATE_3_19_4_TOKEN_WRITER_MAINTENANCE.md).
3. TikTok Shop **não pode ser removido por completo apenas omitindo as três Edge Functions Shop**: M10/M11 incluem seus objetos, o worker compartilhado entende jobs Shop e o frontend tem rota/menu/inputs. O primeiro release precisa de bloqueio server-side testado e de confirmação do estado dos deployments; uma exclusão completa do schema exigiria separar migrations em outro trabalho revisado.
4. Restauração nativa de backup físico Supabase pode copiar jobs/extensões que iniciam assim que o clone termina; não usar esse caminho sem comprovar contenção de efeitos externos. A documentação Supabase também informa que “Restore to a New Project” não copia objetos/configuração do Storage. Ver [runbook](GATE_3_19_4_BACKUP_RESTORE_RUNBOOK.md).

## Bloqueios objetivos

- Restauração de **banco e Storage** em ambiente descartável, sem usar nem alterar a stack local persistente, com validação de esquema, ledger, RLS/RPC, buckets, contagens agregadas e hashes dos objetos.
- Identificação do artefato e do manifesto de backup sob custódia aprovada; a existência/hash foi fornecida pelo proprietário, mas não revalidada aqui.
- Procedimento de manutenção funcional: bloquear novas invocações, parar workers/schedules, drenar requests em voo e provar ausência de qualquer versão antiga que faça `UPDATE` direto dos tokens.
- Bloqueio TikTok Shop verificável em UI, API/Edge e worker, ou decisão explícita de separar as migrations Shop do primeiro release.
- Executar as consultas read-only em staging autorizado e revisar diferenças, grants, RLS, Storage, funções expostas e cron/jobs.

## Próxima ação mínima

1. O proprietário identifica o caminho do manifesto/backup já verificado e aprova um destino Supabase descartável separado da Production e da stack local persistente.
2. Em um subgate separado, executar a restauração completa conforme o runbook, parar em qualquer conflito sem `--clean` e medir hashes/contagens.
3. Implementar e validar localmente um bloqueio server-side de TikTok Shop e um modo de manutenção para writers; isso ainda não está comprovado neste gate.
4. Só então pedir autorização específica para staging. A decisão não aprova staging, Production, migration remota, publicação TikTok ou cobrança.

## Validações executadas neste gate

- `deno --version`: 2.9.8, TypeScript 6.0.3.
- `deno check --node-modules-dir=auto` para cinco entradas: PASS.
- `deno test --node-modules-dir=auto --allow-read=./node_modules/.deno` nos testes relacionados: 38/38 PASS.
- `bun test supabase/functions/_tests/tokens.test.ts`: 12/12 PASS.
- `sha256sum` de M10/M11: correspondentes aos hashes registrados anteriormente.
- Revisão de código local: M10/M11, chamadas a `ensureAccessToken`/`freshShopToken`, callbacks e caminhos Shop.
- Revisão do pacote de comandos `supabase storage cp --help`: CLI instalada v2.117.0 usa `--linked`/`--local`, não `--remote`; sintaxe atual deve ser confirmada no ambiente futuro.
- `git diff --check` e `git status --short`: executados ao final; alterações anteriores preservadas.

Não foram executadas migrations remotas, backup, restauração, deploy, OAuth real, publicação, exclusão de mídia, cobrança, push ou acesso à Production.
