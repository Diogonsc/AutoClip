# Gate 3.19.2 — Ensaio e plano de rollout

## Migrations locais

- M10 `20261103000010_tiktok_refresh_rotation_leases.sql`, SHA-256 `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845`; preservada sem alteração.
- M11 `20261103000011_oauth_refresh_legacy_state_guard.sql`, SHA-256 `61aaeedcd4082bedfc91b86797ae801128524543882fbc7c23c11f535633659f`; corretiva, local-only.

Harness `node scripts/test_gate_316_rpc_concurrency.mjs` inicializa projeto Supabase isolado em `/tmp/autoclip-g316-*`, testa cadeia integral atual, pgTAP, lint e sessões locais. Resultado atual: 250 assertions pgTAP e 53 assertions de integração/concurrency; lint sem erros bloqueantes (1 warning). Não reutiliza nem para a stack persistente `tiktok-saas`.

## Dependências e sequência futura (não executar neste gate)

1. Aprovação específica para staging descartável e verificação de backup/restore.
2. Capturar baseline e confirmar ledger/schema do staging; nunca inferir igualdade pelo ID.
3. Aplicar M10 antes do código que exige colunas e RPCs de lease.
4. Aplicar M11 após M10; ela substitui funções existentes e exige validação de ACL/security definer.
5. Implantar Edge Functions/workers com compatibilidade controlada; impedir coexistência de worker antigo que possa renovar refresh token sem lease.
6. Implantar frontend após RPCs e backend, com cache/versionamento coordenado.
7. Validar callbacks, reconexão, lease, reautorização, autorização cross-workspace, jobs e logs com contas sintéticas.
8. Monitorar; só então decidir, mediante nova aprovação, se teste TikTok de staging é permitido.

## Expand/contract e rollback

O rollout é bloqueado até demonstrar que todas as instâncias de worker e Edge Functions antigas foram drenadas. Código novo antes das migrations pode falhar por colunas/RPC ausentes; migrations antes do código são aditivas, porém M11 muda validações e pode converter legados sem expiry para reautorização. Para falhas após M10/M11, preferir roll-forward corretivo; não prometer rollback de tokens nem revalidar refresh token antigo. Backup/restauração deve ser provado no staging, com escopo e RPO/RTO aprovados.

Abortar em erro de migration, ACL inesperada, conexão em reautorização em massa, aumento de erro de publicação, inconsistência de versão, logs sensíveis, divergência de schema, worker legado ativo ou incapacidade de restaurar. Não aplicar em produção com base neste documento.
