# Gate 3.19.1 — Relatório de validação local

**Escopo:** local-only. Nenhuma conexão ao Supabase Cloud, migration remota, deployment, TikTok real, cobrança, mídia real ou role de produção foi usada/modificada.

## Mudanças locais

- `supabase/migrations/20261103000010_tiktok_refresh_rotation_leases.sql`: lease/fencing Login Kit + Shop e persistência condicional.
- `supabase/functions/_shared/tokens.ts`, `tiktok.ts`, `supabase-db.ts`, `types.ts`: Login Kit usa RPC persistente e exige rotação/expirações válidas.
- `supabase/functions/_shared/tiktok-shop-tokens.ts` e os handlers Shop: um fluxo compartilhado para refresh, CAS, timeout, reautorização em ambiguidade; callback salva via RPC.
- Testes Bun e pgTAP para concorrência, resposta ambígua, geração antiga, autorização de RPC e tokens sintéticos.
- Runner E2E separado com project id, diretório e portas próprios; recusa acesso à stack persistente e Docker remoto. Corrigidos também inicialização do lock, diagnóstico sanitizado e escolha de portas de analytics/shadow/pooler.
- `worker.ts`: cópia do byte buffer para `ArrayBuffer` explícito ao calcular SHA-256, necessária para compatibilidade do `tsc` com tipos TS atuais; sem mudança de algoritmo.

## Resultados executados neste gate

| Comando | Resultado atual | Ambiente/limite |
|---|---|---|
| `bun test supabase/functions/_tests` | 109 passou, 0 falhou | Mocks locais; tokens sintéticos. |
| `node scripts/test_gate_316_rpc_concurrency.mjs` | PASS; migration chain/pgTAP 246 assertions; integração concorrente 48 assertions | Projeto PostgreSQL 17 descartável; inclui duas sessões/processos separados para OAuth e CAS, além da bateria Gate 3.16. Lint: 1 warning, sem erro bloqueante. |
| `npm run test --prefix apps/web` | 45 passou, 0 falhou | Vitest. |
| `npm run typecheck --prefix apps/web` | PASS | TypeScript frontend. |
| TypeScript Edge direcionado (com stub de tipo JSR em `/tmp`) | PASS | Arquivos OAuth/Shop/worker tocados; não substitui `deno check`. Deno não está instalado. |
| `node --check` nos runners E2E | PASS | Node 24 local. |
| `npm run test:e2e --prefix apps/web` | **20 passou, 0 falhou** | Stack Supabase descartável; 10 cenários em desktop Chromium e 10 em mobile Chromium. JUnit: `apps/web/test-results/e2e-junit.xml`; `.last-run.json` indica `passed`, sem falhas. |
| `npm run build --prefix apps/web` | PASS | Vite 8.3.5, 2.413 módulos transformados. |
| `node --test` — cinco arquivos de testes de auditoria explicitamente listados | 59 passou, 0 falhou | Testes locais de wrapper/allowlist; nenhum acesso remoto. A expectativa de inventário foi atualizada de 30 para 31 migrations após adicionar M10 local-only. |
| Lint geral | PENDENTE / ferramenta não identificada | O harness executou lint SQL do banco, com 1 warning local. |
| `git diff --check` | PASS | Executado no fechamento; sem erros de whitespace. |

## Falhas de tentativa E2E e correções do runner

1. Supabase CLI analytics tentou a porta fixa `54327`, em uso por outro serviço. O wrapper agora escolhe e testa nove portas consecutivas livres e configura API, DB, Studio, Inbucket/SMTP/POP3, analytics, shadow DB e pooler na cópia temporária.
2. O runner inferior inicializou `edgeEnvPath` antes de declarar `mediaDir`; corrigido movendo a criação dos arquivos/lock para dentro de `try/finally`.
3. A execução também encontrou um lock deixado pela falha anterior. O PID registrado estava ausente; somente aquele lock do runner foi removido. O runner agora remove lock apenas quando ele próprio conseguiu criá-lo.

As tentativas anteriores pararam/limparam seus próprios projetos temporários. A execução final passou 20/20; relatório JUnit registrou zero failures/errors/skipped e `.last-run.json` registrou `passed`. O diretório temporário e lock da execução foram removidos e não restaram containers com o project id E2E. No fechamento, foi identificado e encerrado somente o processo `psql` residual da execução anterior do harness de concorrência, em endpoint loopback sem listener; nenhum diretório/container do harness restava. A stack persistente `tiktok-saas` foi observada ainda em execução e não foi iniciada, parada ou resetada por este gate.

## Integridade e ambiente

Migration 10 SHA-256 local: `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845`. É um hash de conteúdo local, não aprovação de implantação. Estado inicial do worktree era dirty; mudanças anteriores foram preservadas. Não houve commit/push.

