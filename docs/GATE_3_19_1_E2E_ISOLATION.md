# Gate 3.19.1 — Isolamento do Playwright E2E

## Topologia

`npm run test:e2e --prefix apps/web` chama `apps/web/e2e/run-disposable-e2e.mjs`. O wrapper cria diretório temporário com marcador próprio, project id aleatório, cópia do `supabase/config.toml`, migrations e Edge Functions sem arquivos `.env` secretos, troca portas, exige Docker local por socket Unix, inicializa stack Supabase própria e valida que API/DB são loopback. Chaves locais são passadas apenas ao processo filho. O runner inferior exige `E2E_EPHEMERAL=1` e marcador; chamada direta contra a stack persistente falha.

A limpeza chama `supabase stop` apenas com workdir/project id desse projeto, apaga somente o diretório temporário marcado e remove apenas a imagem única que o próprio runner nomeou. Não há `docker system prune`, `volume prune`, `supabase db reset` ou fallback para `tiktok-saas`.

O runner inicia explicitamente `supabase functions serve` para o workdir descartável; a resposta HTTP 401 da função `media-validate` sem bearer é usada somente como sinal de prontidão do handler. As funções continuam validando sua própria autenticação e HMAC.

## Resultado final deste Gate

`npm run test:e2e --prefix apps/web`: **20/20 aprovados**, 10 cenários em desktop Chromium e os mesmos 10 em mobile Chromium, com zero falhas, erros ou skips no JUnit. O `.last-run.json` registrou `passed`. Quatro mídias sintéticas passaram pela validação local e ficaram em estado `READY/VALIDATED`; não houve publicação real. Após o encerramento, o diretório temporário, lock e containers identificados pelo project id E2E foram removidos. No fechamento também foi encontrado um `psql` residual de uma execução anterior do harness local, ligado a um endpoint loopback já sem listener; foram encerrados apenas esse processo filho e o processo exato do harness. Não havia diretório temporário nem container daquele harness restante. A stack persistente `tiktok-saas` não foi alterada.

## Execução neste Gate

A primeira execução chegou ao `supabase start` e falhou com exit 1; wrapper limpou o projeto temporário. A mensagem foi ajustada para exibir apenas diagnóstico sanitizado. Tentativas seguintes revelaram portas padrão de analytics ocupadas, um erro de inicialização do lock e ausência de `functions serve`, que deixava o worker sem heartbeat e a fixture em `UPLOADING/PENDING`. O wrapper agora isola nove portas, faz cleanup do lock por propriedade e serve funções do projeto efêmero. O resultado Playwright da última tentativa está no relatório de validação. A stack persistente `tiktok-saas` foi observada ainda em execução e não foi iniciada, parada ou resetada.

## Limites

O teste usa Docker Engine local e Supabase CLI; depende das imagens locais e de portas livres. O wrapper recusa contextos Docker não locais. Uma interrupção do host durante execução pode deixar recursos com project id exclusivo; a reconciliação manual deve filtrar estritamente esse ID e nunca usar comandos globais de prune. O E2E não simula OAuth real nem publicação TikTok.
