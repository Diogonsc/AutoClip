# Gate 3.19.2 — Testes adversariais

## Casos e evidências

| Caso | Mecanismo | Resultado deste gate | Limite |
|---|---|---|---|
| Reautorização concluída antes de falha tardia | Bun unit test com barreira/mock; estado de geração novo | PASS: estado novo não é sobrescrito | Não usa provedor real. |
| Resposta bem-sucedida atrasada após reautorização | Bun unit test | PASS: lê e devolve geração persistida sem escrever a antiga | Simulação no store fake. |
| Refresh expiry nula | pgTAP em PostgreSQL 17 descartável | PASS: Login Kit e Shop vão para reautorização | Não inspeciona estado Cloud. |
| Resposta inicial sem refresh/expiry | Bun unit test do callback/token parser | PASS: rejeitada antes da persistência | Mock HTTP. |
| Dois clientes PostgreSQL independentes | Harness descartável | PASS: segundo aguarda lock, recebe BUSY, token não é reutilizado | PG local da Supabase CLI. |
| Dez processos independentes | Dez filhos `psql`, barreira por lock PostgreSQL, aplicação liberada em conjunto | PASS: 1 ACQUIRED, 9 BUSY; todos encerram sem timeout | Multiprocesso OS validado; não dez instâncias de worker com HTTP real. |
| Tentativa de complete obsoleta | RPC CAS local | PASS: retorna false após geração nova | Não protege escrita administrativa direta que ignore RPC. |
| Resolução concorrente de UNKNOWN/quota | Harness Gate 3.16 atualizado | PASS: 53 assertions ao todo, incluídas as de refresh | Fixtures sintéticas, sem carga volumétrica. |

## Falhas reproduzidas e correções

- A atualização de canal após falha de refresh não seguia o resultado CAS. Removida a mutação fora da RPC de versão/attempt.
- SQL não rejeitava explicitamente expiração NULL; adicionada M11 `IS NULL` nas duas funções acquire.
- `save_tiktok_connection` aceitava validade/cifras ausentes; M11 rejeita campos vazios/nulos e datas não futuras.

## Cobertura não demonstrada

Não foi reproduzido cada um dos 25 cenários da solicitação como processo separado. Especificamente: falha de commit pós-resposta, crash real entre envio/recepção, clock skew entre hosts, lease expirar enquanto provedor processa, reautorização/disconnect concorrentes contra conexão real e falha persistente de KMS continuam cobertos apenas por lógica conservadora/mocks ou pendentes. O protocolo deliberadamente transforma ambiguidade em reautorização e não promete recuperação automática.

## Regressão executada

Bun 112/112; PostgreSQL descartável com 250 pgTAP assertions e 53 assertions de integração/concorrência; 10 processos independentes no teste de claim; Vitest 45/45; Playwright descartável 20/20 (desktop/mobile); typecheck/build aprovados. Ver detalhes em `GATE_3_19_2_INDEPENDENT_SECURITY_REVIEW.md`. Deno check permanece não executado porque o binário não está presente.
