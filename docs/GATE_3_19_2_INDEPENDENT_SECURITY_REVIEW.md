# Gate 3.19.2 — Revisão independente de segurança

**Escopo:** revisão local-only, PostgreSQL descartável, mocks TikTok e documentação pública. Nenhuma conexão Cloud, chamada autenticada TikTok, deploy, publicação, cobrança ou alteração remota foi realizada.

## Integridade e evidências

| Evidência declarada | Arquivo/observação | Resultado | Limite |
|---|---|---|---|
| M10 SHA `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845` | `supabase/migrations/20261103000010_tiktok_refresh_rotation_leases.sql` | CONFIRMADO localmente | Não demonstra implantação ou aprovação Cloud. |
| Correção de legado | M11 `20261103000011_oauth_refresh_legacy_state_guard.sql` | Novo arquivo local; SHA `61aaeedcd4082bedfc91b86797ae801128524543882fbc7c23c11f535633659f` | Requer revisão e rollout separado. |
| Dirty worktree preexistente | `git status --short`, branch `main` | Preservado | Há numerosas alterações de gates anteriores; nenhum arquivo foi resetado. |

## Achados adversariais reproduzíveis

1. **Falha assíncrona obsoleta podia sobrescrever reconexão/desconexão.** `ensureAccessToken` marcava `REAUTH_REQUIRED` via atualização de canal incondicional depois de `fail_tiktok_token_refresh`. Se uma nova autorização incrementasse a geração entre a falha antiga e essa escrita, o CAS rejeitaria a falha na tabela OAuth, mas a escrita separada ainda poderia clobber o canal. A correção remove mutações de estado diretas do `TokenStore` do fluxo; as transições são exclusivamente pelas RPCs CAS com attempt e versão.
2. **Expiração ausente em registros legados falhava aberta.** Em SQL, `NULL <= clock_timestamp()` resulta em NULL; uma condição `IF token IS NULL OR expires_at <= now()` não rejeita o caso da expiração nula. M10 tinha esse padrão para Login Kit e Shop. M11 adiciona `IS NULL` explícito e passa estado desconhecido para reautorização, sem tentar reutilizar credencial.
3. **Resposta inicial incompleta do Login Kit podia ser aceita pelo callback.** A troca de código agora exige refresh token e validade positiva do refresh antes de persistir; M11 valida também os campos cifrados e expirações no RPC de persistência.

Não foi demonstrado uso malicioso nem comprometimento. São defeitos locais de concorrência/validação, reproduzíveis por lógica e cobertos agora por testes; M11 ainda não foi aplicado em qualquer ambiente remoto.

## Revisão da migration e modelo

M10 usa estado `READY | IN_FLIGHT | REAUTH_REQUIRED`, `token_version`, UUID de tentativa e horário de início. Claim serializa pelo registro do canal/conexão e usa relógio PostgreSQL. A rede ocorre fora da transação. Complete/fail exigem workspace quando aplicável, versão, estado e attempt, e atualizam tokens/expirações na mesma operação; a geração cresce monotonicamente. Reconnect incrementa geração e limpa lease.

Fencing impede resposta antiga de persistir depois que outra geração vence, sob a premissa de todas as transições utilizarem as RPCs e do banco permanecer íntegro. Não é garantia contra credencial `service_role` comprometida, escrita direta privilegiada que ignore o protocolo, restore/alteração manual de versão ou semântica não testada do provedor. Lease expirada é tratada como ambígua e requer reautorização; isso evita retry inseguro, mas pode exigir reconexão após crash antes do envio. M11 também fail-closes refresh expiry ausente.

RPCs são `SECURITY DEFINER`, `search_path=''`, schema-qualified e EXECUTE destinado a `service_role`; esta revisão leu SQL local e pgTAP. A configuração Cloud permanece a última fotografia documentada do Gate 3.18, não revalidada. O `save_tiktok_connection` local depende de ACL service-role; validar a configuração implantada antes do rollout. Não foi observado SQL dinâmico nessas RPCs.

### Compatibilidade e consumidores

Login Kit é distinto de TikTok Shop. Worker, handlers e funções Shop usam módulos de refresh compartilhados; callback salva via RPC. M10 adiciona colunas com defaults para registros existentes, mas legado sem validade confiável passa a exigir reautorização em M11. Código novo depende do schema M10/M11; implantar código antes das migrations pode causar erro de coluna/RPC. Bundles antigos e Edge Functions antigas durante refresh coexistente exigem estratégia de expand/contract e janela coordenada; staging continua bloqueado.

## RPCs, RLS, Storage e pg_net

- **RPCs:** Migration 09 local contém autorização interna para plano e resolução de job; testes locais cobrem permissões. A fotografia Cloud anterior mostrou assinaturas/grants diferentes e não prova corpos equivalentes. `change_workspace_plan`/`resolve_unknown_job` permanecem bloqueadores de implantação até reconciliação e testes em staging.
- **Storage:** migrations locais implementam validação/quarentena e políticas; a fotografia anterior só confirmou bucket `media` privado e metadados limitados. Isso não prova isolamento efetivo nem segurança temporal da limpeza. Limpeza física deve permanecer desligada até ensaio isolado e verificação remota autorizada.
- **pg_net:** a fotografia anterior observou PUBLIC EXECUTE em 12 rotinas `net`; execução efetiva também requer USAGE no schema e demais condições. Migrations locais chamam `net.http_post` para acionar media-cleanup. Não se recomendam revogações globais sem análise funcional e Supabase; alcance Cloud não foi revalidado.

## Conclusão

Correções locais justificadas foram implementadas em M11 e nos módulos TypeScript, com testes unitários e PostgreSQL descartável. O modelo é conservador frente à ambiguidade, ao custo de reautorização manual. Contrato oficial de TikTok Shop e equivalência Cloud continuam incompletos. **NO-GO para staging/produção.** Ver `GATE_3_19_2_GO_NO_GO.md` e os demais documentos deste gate.

## Validação local executada neste gate

- Bun Edge Functions: 112/112.
- PostgreSQL 17 isolado: 250 pgTAP assertions, 53 assertions de integração/concorrência, incluindo dez processos independentes (`1 ACQUIRED`, `9 BUSY`); lint SQL sem erro bloqueante, 1 warning.
- Vitest: 45/45.
- Playwright no runner Supabase descartável: 20/20 (10 desktop Chromium + 10 mobile Chromium); JUnit indica zero failures/errors/skipped, `.last-run.json` `passed`, e a stack do project ID da execução foi encerrada/removida pelo runner.
- Typecheck e build Vite: aprovados; build transformou 2.413 módulos.
- Auditoria Node: 59/59.
- `bash -n`, `node --check` dos runners e `git diff --check`: aprovados.
- `deno check`: não executado; `deno` não está instalado. Nenhuma instalação remota/global foi tentada.
