# Gate 3.19.1 — Evidência de concorrência

## Mecanismo

O teste unitário usa barreira explícita para segurar a resposta fake do provedor enquanto os demais chamadores tentam obter lease. O teste SQL usa duas sessões `psql` independentes sobre PostgreSQL 17 descartável: a primeira mantém a transação/claim sincronizada e a segunda tenta adquirir a mesma conexão. A migration retorna `BUSY`; após commit da primeira, CAS grava os dois tokens e expirações juntos; uma tentativa atrasada com versão anterior retorna `false`.

## Resultados atuais

- Login Kit: 2 e 10 workers concorrentes em mocks; uma chamada de refresh, uma versão persistida e os demais consumidores reutilizam access token da geração nova.
- TikTok Shop: 2 e 10 workers concorrentes em mocks; uma chamada e persistência única.
- PostgreSQL: duas conexões/processos independentes não reutilizam simultaneamente o refresh token; gravação e tentativa obsoleta exercitadas em PG 17.6 local descartável.
- Migration chain + pgTAP: 246 assertions aprovadas no harness isolado, incluindo ACL, claim único, atomicidade, version fence, lease ambígua, Shop e negação a `authenticated`.
- Harness combinado `node scripts/test_gate_316_rpc_concurrency.mjs`: 48 verificações de concorrência/resolução UNKNOWN aprovadas e inclui o cenário PostgreSQL OAuth multi-processo; execução concluída sem Cloud.

## Cenários cobertos e limites

Cobertos por testes: conexões distintas, workspace, token faltante/expirado, resposta sem refresh rotacionado, HTTP ambíguo, falha de persistência, claim indisponível, lease stale, persistência CAS, reautorização Shop, ACL e chamada antiga atrasada. A lease stale não é recuperada por um novo refresh; o resultado exige reautorização para evitar replay do token potencialmente invalidado.

Os dez concorrentes são modelados por Promises/mock na suíte Bun; o teste de integração com processos distintos demonstra a serialização de duas sessões PostgreSQL independentes. Não foi executado um teste com dez processos de sistema separados. Também não há prova do comportamento temporal do provedor real, nem teste de processo encerrado após resposta externa real. Esses casos permanecem limitações, não afirmações aprovadas.

Os outputs contêm apenas IDs sintéticos e status. Nenhuma credencial TikTok, usuário real ou segredo foi usado.
