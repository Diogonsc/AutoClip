# Phase 1B.2A.1 — persistência SQL e RLS

## Implementado localmente

`20261108000001_seller_oauth_local_foundation.sql` prepara cinco tabelas Seller:

- `seller_oauth_states`: state somente em hash, TTL estrito entre zero e dez minutos, uso único e vínculo opcional a uma conexão do mesmo workspace.
- `seller_connections`: identidade do Seller por workspace, com `user_type = 0` e status em allowlist.
- `seller_credentials`: apenas campos ciphertext e metadados de expiração/lease; não há RPC de leitura ou escrita de tokens nesta etapa.
- `seller_shops`: lojas autorizadas vinculadas por FK composta a `(connection_id, workspace_id)`.
- `seller_audit_events`: trilha operacional sem campos de segredo permitidos no JSON de metadata.

As transições de state são protegidas por trigger: `PENDING → CLAIMED → COMPLETED|FAILED`, ou `PENDING → EXPIRED`; estados terminais não podem ser reabertos.

## RPCs transacionais

| RPC | Chamador | Contrato |
| --- | --- | --- |
| `create_seller_oauth_state` | `authenticated` com `private.can_edit(workspace)` | Cria state hash e evento `OAUTH_STARTED`. |
| `claim_seller_oauth_state` | somente `service_role` | `UPDATE ... WHERE status = 'PENDING' AND expires_at > now() RETURNING`; consome o state antes de qualquer troca remota. |
| `fail_seller_oauth_state` | somente `service_role` | Marca state já claimed como `FAILED`, sem reabri-lo. |
| `save_seller_connection_metadata` | somente `service_role` | Cria/atualiza metadados Seller e conclui state claimed. |
| `complete_seller_oauth_state` | somente `service_role` | Adaptador compatível para a RPC de metadados. |
| `upsert_seller_authorized_shops` | somente `service_role` | Persiste lojas normalizadas, exigindo conexão do mesmo workspace. |

Todas são `SECURITY DEFINER` com `search_path = ''`; `EXECUTE` foi revogado de `public`, `anon` e, onde aplicável, `authenticated`.

## Evidência local executada em 2026-11-08

Banco: Supabase local descartável, sem projeto remoto vinculado.

```text
supabase db reset --local --no-seed                 PASS
supabase test db --local                            PASS (19 arquivos, 299 testes)
supabase test db --local ...19_seller...test.sql    PASS (25 testes)
```

O teste `19_seller_oauth_persistence.test.sql` cobre RLS para `authenticated` e `anon`, grants de RPC, replay, expiração, state terminal, conexão cruzada entre workspaces, FK composta de lojas, e rejeição de metadata com token. O claim concorrente também foi exercitado com duas sessões `psql` independentes: uma concluiu e uma recebeu rejeição; o state terminou `CLAIMED`.

## Limites e pendências

- Não houve migration, deploy, OAuth, token exchange ou chamada Sandbox remota.
- Callbacks públicos, criptografia AES-GCM, persistência de tokens e refresh concorrente continuam fora desta entrega.
- A Redirect URI registrada ainda precisa de roteamento que diferencie Seller OAuth do callback Content Posting, ou de uma URI Seller exclusiva no Partner Center.
- A feature flag continua desabilitada.

**Status 1B.2A.1: GO local para a camada SQL/RLS.**

**Status da Fase 1 completa: NO-GO**, até callback, criptografia, refresh, deploy controlado e homologação Sandbox.
