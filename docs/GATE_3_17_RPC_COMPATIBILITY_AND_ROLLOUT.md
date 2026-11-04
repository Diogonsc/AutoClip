# Gate 3.17 — compatibilidade da RPC e plano de rollout

## Decisão

**Estratégia escolhida: compatibilidade transitória fail-closed.** A migration 09 mantém `public.resolve_unknown_job(uuid,text)` como stub `SECURITY INVOKER`, com `search_path` vazio e sem acesso a tabelas. A chamada legada sempre retorna SQLSTATE `0A000` e mensagem para atualizar/recarregar o AutoClip. O stub não cria `request_id`, não delega para a RPC nova e não altera job, quota ou auditoria.

A RPC nova `resolve_unknown_job(uuid,text,uuid)` continua sendo a única que executa a transição e mantém autorização OWNER/ADMIN do workspace ou serviço interno, validação do request ID, idempotência e isolamento. O teste pgTAP verifica que o cliente legado recebe o erro controlado e que o job continua `UNKNOWN` sem linha de resolução.

Nenhuma conexão Cloud ou implantação foi feita. A migration 09 foi alterada localmente antes de qualquer aprovação ou aplicação Cloud. **Não há migration adicional necessária para o stub**, pois ele foi incluído na migration 09 que ainda não foi aplicada ao Cloud. O hash da migration mudou; qualquer aprovação/hashes anteriores para a versão antiga ficam substituídos.

## A — Inventário de consumidores

Busca estática no repositório (`rg -n "resolve_unknown_job"`) encontrou:

| Consumidor | Assinatura/estado |
|---|---|
| `apps/web/src/components/JobDetail.tsx` | Cliente atual envia `p_job`, `p_outcome`, `p_request_id`; request ID UUID persiste em memória para retries da mesma tentativa lógica. |
| `supabase/functions/**` | Nenhum consumidor encontrado. |
| Worker (`scripts/`, `deploy/`) | Nenhum consumidor encontrado. |
| `supabase/tests/database/02_tiktok_integration.test.sql` | Casos atualizados chamam assinatura de três parâmetros. |
| `supabase/tests/database/15_rpc_security_triage.test.sql` | Verifica a assinatura nova e o stub legado fail-closed, incluindo ausência de efeitos. |
| Migrations `20261021000002` e `20261103000009` | Definem a assinatura antiga e depois criam a nova/stub transitório. |
| Documentação Gate 3.12–3.16 | Histórico/revisão; não são consumidores em runtime. |
| Bundle antigo | Artefato implantado não está disponível no repositório para inspeção direta. Seu contrato conhecido chama a assinatura antiga; o stub permite resposta controlada sem mutação. |

O `ErrorBox` atual renderiza a mensagem de erro retornada. O stub dá ao cliente antigo uma instrução para recarregar; a conexão, o cache e a exibição real de bundles antigos ainda devem ser ensaiados em staging. Não se presume que qualquer bundle legado esteja atualmente em uso.

## B — Alternativas comparadas

| Estratégia | Segurança | UX/risco | Dependências e rollback |
|---|---|---|---|
| Janela de manutenção | Forte se a ação for realmente bloqueada e o corte coordenado. | Indisponibilidade temporária da resolução manual; usuário pode precisar aguardar. | Requer anúncio/controle de manutenção e coordenar frontend + DB. Rollback simples é reabrir o serviço compatível, se o estado não mudou; mudanças de DB ainda requerem reconciliação. |
| Stub legado fail-closed (escolhida) | Mantém a superfície antiga executável apenas para retornar erro; não faz mutações, não cria chave e não contorna autorização da RPC nova. | Cliente antigo recebe erro acionável e precisa recarregar/atualizar; sem resolver job até atualizar. | Incluído no mesmo arquivo de migration pendente para minimizar janela. Requer testar overload no PostgREST e atualização de schema cache. Rollback não deve restaurar a implementação permissiva antiga; usar correção forward. |
| Detecção obrigatória de versão do frontend | Pode bloquear UI antes da chamada se houver mecanismo confiável de versão mínima. | Experiência mais clara, mas clientes em cache podem não consultar o endpoint/versão; UI não é fronteira de segurança. | Exige endpoint/manifest versionado, cache headers e compatibilidade. Deve complementar, não substituir, o stub. Rollback requer versionamento cuidadoso do manifesto. |

A estratégia de menor risco operacional é o stub transitório, com manutenção como fallback se a resposta do overload/schema cache não for previsível no staging. A versão do frontend pode ser adicionada depois como melhoria de UX, mas não autoriza a RPC.

## C — Mudanças locais

1. `supabase/migrations/20261103000009_harden_manual_plan_and_unknown_resolution.sql`: em vez de remover a assinatura antiga, ela é substituída por uma função invoker que lança o erro controlado; execução fica revogada para `PUBLIC`/`anon` e concedida a `authenticated` apenas para receber a resposta de compatibilidade.
2. `supabase/tests/database/15_rpc_security_triage.test.sql`: passa a exigir as duas assinaturas (a antiga somente stub) e testa erro antigo sem mudança do job nem registro de resolução. Plano do arquivo atualizado de 39 para 42 assertions.
3. `scripts/test_gate_316_rpc_concurrency.mjs`: agora copia testes ao projeto descartável e roda pgTAP sobre a cadeia limpa antes dos casos concorrentes; adiciona verificação do resultado de pgTAP e mantém a stack isolada.
4. [Gate 3.16](/home/diogo-nascimento/Documentos/Atual/AutoClip/docs/GATE_3_16_PREDEPLOY_VALIDATION.md): permanece evidência histórica do gate anterior; este documento registra a atualização da compatibilidade.

O banco persistente local já tinha registrado a versão 09 antes desta alteração de arquivo. Não foi resetado nem alterado para simular a nova definição. O harness limpa aplica a fonte atual em stack descartável. Antes de qualquer uso compartilhado do banco local, é preciso reconciliar essa diferença pelo fluxo local apropriado; o ledger só registra a versão, não o hash do arquivo.

## D — Testes locais

| Comando/verificação | Resultado |
|---|---|
| `node --check scripts/test_gate_316_rpc_concurrency.mjs` | Aprovado. |
| `node scripts/test_gate_316_rpc_concurrency.mjs` | Aprovado: stack descartável aplicou migrations da fonte atual; pgTAP **15 arquivos / 225 testes** aprovados; cenários PostgreSQL multi-sessão **41 assertions** aprovadas; lint local limpo de erros bloqueadores (1 linha de aviso). |
| `npm run test --prefix apps/web` | **45/45** em 5 arquivos. |
| `WORKER_HEALTH_PORT=19782 npm run test:e2e --prefix apps/web` e repetição isolada `WORKER_HEALTH_PORT=19783 npm run test:e2e --prefix apps/web` | **20/20** em cada execução. Uma execução concorrente com o harness de banco teve 19/20: timeout ao aguardar o formulário no viewer mobile; o mesmo cenário passou nas execuções isoladas. Causa da intermitência não comprovada. Fixtures sintéticas; nenhuma publicação TikTok real. |
| `npm run build --prefix apps/web` | Aprovado; inclui `tsc --noEmit` e build Vite. |
| `node --test scripts/cloud-audit/readonly-audit.test.mjs` | **19/19** aprovados. |
| `git diff --check` | Aprovado. |

O teste “cliente legado” chama a assinatura de dois parâmetros sob `authenticated` e valida o erro e ausência de efeitos. A chamada de três parâmetros é validada por pgTAP, concorrência e consumidor atual estático. A suíte Playwright não percorre a resolução `UNKNOWN`; o ensaio visual/HTTP do erro de bundle antigo continua pendente para staging.

## E — Rollout proposto (não executado)

### Pré-condições

- Revisão e aprovação individual do novo hash da migration e dos testes.
- Reconciliação read-only atualizada do Cloud; não inferir equivalência de conteúdo pelo ledger.
- Backup de banco restaurável ensaiado; inventário/configuração Storage respaldados para os demais migrations.
- Staging com versão de PostgreSQL, PostgREST e fluxo de autenticação compatíveis.
- Plano de observação de erros da RPC e clientes em cache; sem segredos nos logs.
- Confirmar mecanismo de migrations aplica uma versão como unidade e seu comportamento de rollback em erro.

### Ordem

1. Ensaiar primeiro só a migration 09 em staging, com versão antiga e nova do frontend. Não misturar essa decisão de compatibilidade com o rollout de mídia.
2. Aplicar migration 09 como unidade aprovada: assinatura nova protegida, stub antigo invoker e grants mínimos. Confirmar refresh/visibilidade do schema cache PostgREST pelo mecanismo suportado no ambiente.
3. Smoke test com cliente atualizado: OWNER/ADMIN do workspace, request ID presente, transição idempotente; testar também EDITOR e usuário de outro workspace negados.
4. Smoke test de bundle antigo: duas chaves antigas de chamada, resposta controlada, job continua `UNKNOWN`, nenhum evento/resolução/quota adicional.
5. Publicar o frontend novo; considerar cache de navegador/CDN/Service Worker e disponibilizar instrução de recarga. Não fazer fallback automático para assinatura de dois parâmetros.
6. Observar chamadas legadas e falhas da RPC durante o prazo definido pelo proprietário. Não remover o stub até confirmar adoção e aprovar migration futura separadamente.
7. Coordenar Edge Functions/worker somente se uma dependência for descoberta; a busca local atual não encontrou consumidores. Este rollout da RPC não inicia publicação nem modifica scheduler.

As migrations 01–08 (grupos/lotes, carrossel, MIME, validação/quarantine, revalidação/cleanup, heartbeat, credenciais anti-replay e confirmação do upload) são uma sequência de rollout própria e não devem ser incluídas automaticamente neste corte. Exigem reconciliação Cloud, ensaio Storage/Edge/worker, análise de locks/backfill/WAL e aprovações por arquivo.

### Smoke tests e abortar

Abortar diante de erro de migration, assinatura/schema cache inesperado, chamada nova sem request ID, bundle antigo produzindo qualquer mutação, erro cross-workspace, evento/quota duplicado, aumento anormal de jobs `UNKNOWN` ou incompatibilidade de worker/Edge. Não tentar outro grant ou SQL para contornar falha.

Após abortar: congelar a sequência, preservar logs sanitizados e estado da migration; não repetir mutação às cegas. Fazer diagnóstico read-only e reconciliar o commit. Aplicar apenas correção forward aprovada; restauração só por plano previamente ensaiado.

### Rollback/recuperação

Não restaurar a função antiga permissiva. Se o cliente novo falhar, manter o stub fail-closed e ocultar/desabilitar temporariamente a ação por janela de manutenção aprovada, enquanto se prepara correção forward. Para erro pós-commit ou resultado incerto, consultar o estado da migration e objetos por procedimento read-only; não reexecutar manualmente `DROP`/`CREATE`. A remoção futura do stub precisa de migration separada, medição de chamadas antigas e aprovação própria.

## Critérios de GO/NO-GO

**GO para revisão técnica local:** pgTAP limpo, concorrência, Vitest, Playwright, typecheck/build e verificações estáticas aprovados nos resultados acima.

**NO-GO para implantação agora:**

- Novo hash ainda precisa aprovação específica; hash aprovado antigo não abrange o stub.
- Conteúdo e estado Cloud não foram reconciliados neste gate.
- Overload de dois argumentos e erro controlado ainda precisam ser observados através de PostgREST em staging, inclusive com bundle em cache.
- Backup/restore e comportamento operacional do migration runner ainda precisam ensaio.
- O rollout das outras oito migrations requer plano coordenado independente para Storage/Edge/worker.

## Riscos residuais

- O stub melhora a resposta de cliente antigo, mas o bundle pode mostrar erro genérico ou conservar cache; validar UX em staging.
- Se clientes antigos continuarem ativos, resolução manual ficará indisponível para eles até atualizar; essa indisponibilidade é intencional e segura.
- A alteração de uma migration já aplicada no banco local persistente cria diferença entre fonte e estado desse banco. O ensaio foi feito em stack descartável limpa; reconciliar ambiente local persistente separadamente.
- O harness cobre interleavings controlados, não carga de produção nem falha de rede em cada ponto de commit.
- Riscos Cloud anteriores (`pg_net`, RLS/Storage implantados, segredos, equivalência de funções) continuam pendentes e não são reduzidos por compatibilidade de RPC.

## Hashes atuais

Recalcular imediatamente antes de qualquer futura aprovação/execução:

| Arquivo | SHA-256 observado neste gate |
|---|---|
| `supabase/migrations/20261103000009_harden_manual_plan_and_unknown_resolution.sql` | `b97d3e5b0993d534d3bce689564f1cbd585c5784244004f1a1eea062708d76d0` |
| `supabase/tests/database/15_rpc_security_triage.test.sql` | `017648143dc7d15ba3c6ea52222316d0fee5b6e063311af723e79d8a1cc20a2d` |
| `scripts/test_gate_316_rpc_concurrency.mjs` | `774fa4ce1bd3fa1f8d73ed871d22b00aa052067068a2f233998fa405c6fe25b9` |

## Próximo gate

Gate 3.17.1: revisão independente do diff/hash da migration 09 e do stub overload; depois, somente mediante aprovação separada, ensaio de staging compatível com PostgREST e bundles antigo/novo. Nenhuma autorização de acesso ou implantação Cloud decorre deste gate.
