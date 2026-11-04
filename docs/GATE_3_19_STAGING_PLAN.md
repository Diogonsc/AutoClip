# Gate 3.19 — plano de staging controlado

Este runbook prepara uma futura homologação isolada. Não executa passos remotos nem concede autorização para staging, produção, publicação TikTok, limpeza física ou cobrança.

## Pré-requisitos de entrada

1. Projeto Supabase staging separado de produção, confirmado pelo proprietário e sem reutilizar banco/projeto `djrwfvcxgpyknmizqumn`.
2. Vercel preview/host de teste isolado; dados e domínios não podem apontar para produção.
3. Secrets e chaves exclusivos para staging, criados pela interface oficial e nunca copiados para chat/repositório. `service_role`, worker secret e chave de criptografia têm donos, rotação e logs de acesso definidos.
4. Contas TikTok de teste autorizadas; confirmar aprovação/scopes, redirect URI, limites e modo de publicação. Teste inicial usa mocks; qualquer publicação real demanda autorização separada.
5. Backup e restore completos ensaiados em staging descartável, incluindo DB, Storage/configuração relevante e secrets regeneráveis. Validar ponto temporal, permissões e duração.
6. Métricas/alertas para erros de RPC, fila, leases, OAuth refresh, publicação duplicada, quota e limpeza; logs redigidos.
7. Cada migration, Edge Function e frontend tem hash aprovado, ordem e rollback/forward plan por escrito. Cloud drift reconciliado.
8. `autoclip_cloud_auditor` continua `NOLOGIN`; não é credencial de homologação.
9. Limpeza física permanece desligada e dry-run ligado; billing/checkout/webhooks financeiros não configurados para cobrar.
10. Aprovação humana explícita de cada componente; nenhuma permissão ampla `PUBLIC`/`service_role` é alterada como atalho.

## Sequência futura (cada item requer autorização própria)

### Gate S0 — selecionar e isolar ambiente

- Confirmar project ref, endpoint, owners e ausência de vínculo com produção.
- Conferir variáveis de Vercel, Supabase CLI/ambiente e URLs da aplicação sem mostrar valores secretos.
- Bloquear e parar se host, project ref ou destino de callbacks divergirem.

### Gate S1 — backup e recovery

- Criar ponto de recuperação com método oficial aprovado; registrar ID/hash e hora local como evidência de cliente, não assinatura de servidor.
- Restaurar em instância temporária e validar schema, policies, Storage e login sintético.
- Critério: recuperação reproduzível com runbook e RTO/RPO definidos. Caso contrário NO-GO.

### Gate S2 — migrations (subgates por migration)

- Revalidar inventário/hash e drift. Migrations 01–02, 03–05, 06–08 e 09 são cortes funcionais diferentes.
- M01 antes de M02. M03 coordenada com M04 sem janela em que imagem não validada possa ser usada. M04 backfill medido antes, com amostra representativa e rollback por restore. M05 depende do estado/pipeline M04. M06 e M07 precisam de worker/Edge compatíveis; M08 depende do marker de upload. M09 é isolada de releases de mídia e frontend.
- Para cada arquivo: janela, duração esperada baseada em ensaio, lock/statement timeouts, evidência anterior/depois, stop conditions e operador. Parar diante de objeto divergente, lock acima do orçamento, warning inesperado, erro, migration parcialmente confirmada ou schema cache desatualizado.
- Não há down migrations universalmente seguras. Em erro pós-commit, congelar rollout, diagnosticar read-only e recuperar via plano aprovado/restore; não executar migration repetida às cegas.

### Gate S3 — Edge Functions e segredos

- Implantar somente função compatível com schema atual no ambiente staging. Validar assinatura/versão de payload, JWT/service auth, timeout, limites, headers, idempotência e erros sem conteúdo secreto.
- Testar segredo ausente/incorreto e rotação de secrets por mecanismo aprovado. Verificar logs sanitizados e CORS.
- O `video-worker-api` deve validar HMAC/nonce/time window e não aceitar replay. `media-validate` deve confirmar bytes, hash, tipo/codec e tamanho do objeto real.
- Não disparar `publication-worker`/`media-cleanup` sem autorização separada; iniciar validator somente com mídias sintéticas.

### Gate S4 — frontend e auth

- Usar usuário sintético por workspace; testar login, logout, refresh, recovery, membership removida e troca de workspace.
- Publicar preview compatível. Na RPC de resolução, testar overload novo com request ID e stub legado fail-closed via PostgREST/schema cache. Bundle velho deve receber falha clara e não alterar job/quota/evento.
- Garantir que browser bundle contém somente publishable/anon key, sem `service_role`, client secret, worker secret ou encryption key.

### Gate S5 — autorização, RLS e Storage

- Criar Workspace A/B e roles OWNER/ADMIN/EDITOR/VIEWER sintéticas. Para cada tabela, testar SELECT/INSERT/UPDATE/DELETE e troca de `workspace_id`, FK cruzada, membership revogada, RPC com argumentos de outro tenant, grupo/canal/mídia estrangeiros.
- Exercitar signed URL curta se parte do fluxo aprovado; testar download/upload/deletion de objetos sintéticos em buckets isolados, com owner, workspace path e políticas. Nenhum arquivo real.
- Comprovar que `authenticated DELETE` observado fica limitado por RLS/constraints, ou bloquear.

### Gate S6 — filas, quota e worker

- Rodar múltiplas sessões com barreiras sobre request IDs igual/diferentes, último item de quota, cancelamento/reagendamento vs claim, lease expirado, timeout e restart de Docker.
- Verificar transições permitidas, eventos únicos, reserva/consumo/reembolso e nenhuma chamada externa com mocks.
- Testar persistência/idempotência após encerramento de worker e recuperação de job `UNKNOWN`.

### Gate S7 — OAuth, mídia e limpeza

- Primeiro confirmar documentação oficial do contrato e datas da API TikTok; usar mocks de rotação. Fazer teste de refresh concorrente da mesma conexão e gravação atômica de access/refresh/expiry. Casos de timeout após refresh, token anterior invalidado, resposta sem refresh, token expirado e reautorização.
- Para publicação, iniciar em modo mock/Inbox se suportado. Direct Post ou publicação real precisa autorização explícita independente.
- Fazer cleanup somente em dry-run com objetos sintéticos e logs de elegibilidade. Não executar Storage delete real; provar ausência de jobs ativos/UNKNOWN, claims, referências compartilhadas e grace period. Manter opção off por padrão.

### Gate S8 — avaliação e saída

- Revisar resultados, erros sanitizados, métricas e evidência de rollback/recovery; preservar os relatórios fora do repositório e modo restrito.
- Aprovar somente se os critérios GO da matriz final forem atendidos e nenhum achado CRITICAL/HIGH bloqueante estiver aberto. A aprovação de staging não autoriza produção.

## Smoke tests e parada

**GO por etapa:** hashes revisados; projeto e host esperados; migração/serviço compatíveis; smoke tests aprovados; sem acesso cross-tenant; quota consistente; logs sem tokens; backup restaurável; evidência reproduzível.

**Abortar:** qualquer mismatch de projeto/hash, extensão/catalog incompatível, policy/ACL diferente da revisão, erro SQL/post-commit ambíguo, uso de secret inesperado, publicação duplicada, mutação cross-tenant, refresh token não salvo atomicamente, reserva inconsistente, backfill excede orçamento, cleanup seleciona item referenciado/UNKNOWN ou restore não validado.

Ao abortar: congelar sequência, não repetir mutações, não rodar down/`DROP`, preservar diagnóstico sanitizado, produzir estado read-only e decidir recuperação separada. Restaurar somente conforme plano ensaiado e autorização explícita.

## Rollback e recuperação

- Preferir correção forward com nova migration aprovada, quando reversão de dados não for segura.
- Para schema, considerar restore do snapshot se migration interromper invariantes; ensaiar antes e aceitar RPO/RTO explicitamente.
- Para frontend/Edge, rollback de bundle só é permitido se compatível com o schema atual (RPC stub/capability); não restaurar cliente que invoque mutação insegura.
- Para Storage, apagar somente objetos sintéticos de staging com autorização daquele teste; produção sem exclusão neste plano.
- Para OAuth, se rotação ficar ambígua, não repetir o token antigo automaticamente. Marcar conexão sintética para reautorização e comparar o estado persistido.
- Para quota/jobs, não editar estados manualmente para “corrigir”; reconcile events/reservations em ambiente de teste e usar RPC idempotente aprovada.

## Aprovações separadas necessárias

1. Aprovar projeto e backup de staging.
2. Aprovar cada migration e respectivo hash, uma de cada vez.
3. Aprovar cada implantação de Edge e segredo/configuração.
4. Aprovar deploy de preview/frontend staging.
5. Aprovar criação de fixtures e teste cross-tenant.
6. Aprovar conexão TikTok de teste; publicação real tem gate próprio.
7. Aprovar cleanup dry-run; delete físico continua bloqueado até outra aprovação.
8. Decidir billing fora deste roadmap até última fase.

Este plano é documental; nenhum passo foi executado.
