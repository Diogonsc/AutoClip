# Gate 3.19.4 — inventário e manutenção de escritores OAuth

## Contrato de M10/M11

- M10 `20261103000010_tiktok_refresh_rotation_leases.sql` adiciona version/state/attempt/lease e RPCs de acquire/complete/fail a `oauth_connections` **e** `tiktok_shop_connections`, além das funções de salvamento inicial.
- M11 `20261103000011_oauth_refresh_legacy_state_guard.sql` substitui acquires para exigir validade conhecida e falhar fechado diante de refresh expiry desconhecida, para Login Kit **e Shop**.
- Hashes locais verificados em 2026-11-04: M10 `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845`; M11 `61aaeedcd4082bedfc91b86797ae801128524543882fbc7c23c11f535633659f`.
- A janela M10 aplicada/M11 pendente não pode ter escritor ativo. A versão antiga do worker pode fazer atualização direta de tokens sem fencing; RPCs novas não impedem uma versão antiga com `service_role` de gravar direto.

## Inventário local dos caminhos de escrita/renovação

| Componente | Caminho | Efeito | Tratamento na janela |
|---|---|---|---|
| `publication-worker` | `runtime.ensureToken` chamado no fluxo de publicação/retry/polling (`_shared/worker.ts`) | Pode renovar Login Kit; o entrypoint também encaminha jobs Shop a `tiktok-shop-publish` | Parar scheduler/instâncias; bloquear invocações até código novo e M10+M11 estarem prontos. |
| `tiktok-channel` | injeta `ensureToken` em `handlers.ts` para consultas/desconexão | Pode provocar refresh ao buscar perfil/revogar | Ativar barreira de manutenção e drenar chamadas; pausar ações de canal. |
| `tiktok-oauth-callback` | chama `save_tiktok_connection` | Persiste access/refresh/expiração de nova autorização; não é refresh periódico, mas depende de RPC/schema compatível | Suspender novos OAuth e drenar callbacks durante a alteração de schema. |
| `tiktok-shop` | chama `freshShopToken` e APIs do Shop | Renova token Shop; sincroniza produtos | Não invocar nem implantar no release funcional enquanto Shop permanecer desativado. |
| `tiktok-shop-publish` | chama `freshShopToken` | Renova token Shop durante publicação afiliada | Bloquear e confirmar que nenhuma versão antiga permaneça exposta. |
| `tiktok-shop-oauth-callback` | chama `save_tiktok_shop_oauth_connection` | Salva credenciais Shop iniciais | Suspender callback e conexão Shop. |
| Serviços de worker externos | processo persistente de publicação/vídeo, cron/scheduler e invocações agendadas | Podem iniciar chamadas acima sem tráfego interativo | Inventariar todos os hosts/containers/schedules no ambiente alvo e parar/drain por ID de instância. Nomes de serviços não são presumidos neste documento. |

Evidência no código local: `supabase/functions/_shared/runtime.ts`, `tokens.ts`, `tiktok-shop-tokens.ts`, `handlers.ts`, `worker.ts`; entrypoints `publication-worker`, `tiktok-channel`, `tiktok-oauth-callback`, `tiktok-shop`, `tiktok-shop-publish`, `tiktok-shop-oauth-callback`; SQL M10/M11. Isso **não** comprova quais versões estão implantadas.

## Plano de manutenção obrigatório antes de M10/M11

### Gate M0 — identificar e habilitar manutenção

1. Obter inventário read-only das Edge Functions implantadas, triggers/jobs e todos os workers/cron que podem invocar os endpoints acima.
2. Usar um mecanismo de manutenção compatível com o código antigo, revisado e testado, que responda fail-closed antes de ler/gravar tokens. A implementação atual não prova que exista um kill switch global; não contar apenas com UI escondida ou desligar o scheduler.
3. Pausar submissões novas, OAuth starts/callbacks, refresh, publicação e polling. Pausar também Shop. Não interromper sessões de banco à força sem identificação/approval.

### Gate M1 — drenar escritores antigos

1. Parar publication workers, vídeo worker se ele puder iniciar publication, cron/scheduler e outros consumidores.
2. Impedir tráfego em `publication-worker`, `tiktok-channel`, callbacks OAuth e Shop pelo guard de manutenção/roteamento autorizado.
3. Aguardar o tempo máximo de request/lease observado, confirmar contagem zero de instâncias em execução e zero chamadas em voo por logs/métricas sem conteúdo sensível.
4. Comparar hash/build/versão de todas as Edge Functions com a allowlist aprovada. Confirmar ausência de versões antigas e acesso direto `UPDATE` fora do RPC esperado. A evidência vem de inventário remota autorizado, não do repositório local.
5. Se uma instância não puder ser localizada/drenada, ou a manutenção não impedir sua invocação, **parar: NO-GO para M10**.

### Gate M2 — migrations e troca de código

1. Confirmar backup/restore integral aprovado, ledger/schema e hashes M10/M11 no staging autorizado.
2. Com todos os escritores suspensos, aplicar migration localmente revisada de M01–M09 conforme dependências aprovadas; não executar nesta etapa.
3. Aplicar M10 e imediatamente M11, na mesma janela de manutenção; não iniciar worker, callback ou endpoint entre elas.
4. Validar assinatura, proprietário, `SECURITY DEFINER`, `search_path`, grants e estados por `GATE_3_19_4_READ_ONLY_AUDIT.sql`; fazer testes sintéticos de acquire/complete/fail com workspace isolado.
5. Implantar apenas versões compatíveis aprovadas dos endpoints, manter manutenção ligada; verificar não há nenhum deploy antigo ou caminho de token não-CAS.
6. Retomar primeiro os serviços não-publicadores necessários; verificar métricas. Liberar refresh/callback somente após checks de banco/código. Reabrir publicação em gate separado.

## Parada e recuperação

- Erro em migration, ACL/RLS diferente, writer antigo, chamada externa de Shop, aumento de `REAUTH_REQUIRED`, refresh ambíguo, token version stale, ou qualquer segredo em log: manutenção permanece ativa; suspender escritores e diagnosticar somente leitura.
- M10/M11 não têm rollback de token seguro depois que o TikTok invalidar refresh token antigo. Preferir roll-forward compatível/reautorização conservadora; não restaurar snapshots de tokens antigos por cima de uma geração nova.
- Em falha de schema, recuperação do banco só via plano de restore aprovado e com análise de perda de dados desde o snapshot. Nunca usar `pg_restore --clean` nem reiniciar código antigo sobre schema novo.

## Limite de prova

Este inventário é estático/local. A existência de uma função no repositório não demonstra que a versão correspondente esteja implantada. Não houve consulta a deployments, schedules, logs, filas ou conexões Production neste gate.
