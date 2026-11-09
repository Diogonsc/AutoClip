# TikTok Shop Seller OAuth — GO/NO-GO para Sandbox

**Estado desta revisão:** NO-GO. Esta matriz não autoriza alterações remotas.

## Matriz de decisão

| Critério | Estado | Evidência / ação necessária | Decisão |
|---|---|---|---|
| Código de state, callback, criptografia e refresh | Localmente aprovado | pgTAP, testes Seller e ensaio local | Não basta para Sandbox |
| Endpoint Seller Start autenticado | AUSENTE | Implementar e revisar em PR próprio | BLOQUEADOR |
| UI chama Seller Start | AUSENTE | Implementar UX protegida por flag/permissão | BLOQUEADOR |
| Flag fail-closed | APROVADO LOCALMENTE | `TIKTOK_SHOP_ENABLED = false` constante | Manter até aprovação |
| Redirect URI compartilhada | NÃO VERIFICADO | Conferir no Partner Center o valor exato `https://autoclipe.vercel.app/tiktok/callback` | BLOQUEADOR |
| App/service ID Seller | NÃO VERIFICADO | Confirmar que corresponde ao serviço Seller ROW/BR sem registrar valor em Git | BLOQUEADOR |
| Secrets backend | NÃO CONFIGURADO/VERIFICADO | Configurar somente após aprovação, no Supabase Edge Functions | BLOQUEADOR |
| Migrations remotas | NÃO VERIFICADAS | Inventariar e aplicar só em janela aprovada | BLOQUEADOR |
| Edge Function compartilhada publicada | NÃO VERIFICADA | Confirmar versão/deploy do callback | BLOQUEADOR |
| Contrato token/refresh real | NÃO VERIFICADO | Smoke Sandbox com conta autorizada e leitura segura | BLOQUEADOR |
| Catálogo/shops Sandbox real | Não pertence a esta decisão de OAuth | Validar em fase posterior, com endpoints e escopos confirmados | PENDENTE |
| Content Posting smoke tests | Localmente aprovado | Executar smoke remoto após qualquer publicação | OBRIGATÓRIO |
| Rollback revisado | Documentado | `SELLER_DEPLOY_ROLLBACK_RUNBOOK.md` | OBRIGATÓRIO |

## Variáveis necessárias (nomes apenas)

Configurar como **Supabase Edge Function secrets**, nunca no bundle Vite ou browser:

- `TIKTOK_SHOP_APP_KEY` — identificador do app TikTok Shop.
- `TIKTOK_SHOP_APP_SECRET` — segredo do app.
- `TIKTOK_SHOP_SELLER_SERVICE_ID` — identificador do serviço Seller; confirmar antes do uso.
- `TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY` — chave AES-256-GCM codificada em base64, backend-only.
- `WEB_URL` — origem pública exata, sem barra final.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — runtime Supabase; não imprimir valores.

`TIKTOK_SHOP_SELLER_REDIRECT_URI` aparece no exemplo local, mas não é consumida pelo builder atual. Não a tratar como fonte de verdade até uma mudança revisada que valide valor fixo/allowlist.

## Ordem proposta, sujeita a aprovação manual

1. **Revisão de código:** endpoint/UI Seller Start, timeout e observabilidade; testes locais verdes.
2. **Partner Center:** confirmar uma única Redirect URI compartilhada, host/serviço Seller e escopos concedidos. Registrar evidência sem secrets.
3. **Supabase leitura:** comparar inventário remoto de migrations/funções/configuração contra o commit aprovado; aprovar janela e backup/restore.
4. **Configuração segura:** inserir secrets no backend por operador autorizado; validar presença, nunca valores.
5. **Migrations:** aplicar migrations Seller em ambiente Sandbox/isolado com plano de rollback.
6. **Edge Function:** publicar a versão revisada do callback e a futura função Seller Start; manter flag desligada.
7. **Smoke Content Posting:** conectar/reconectar uma conta de teste existente, validar callback e garantir ausência de regressão em publicação/agendamento sem publicar conteúdo real desnecessário.
8. **Sandbox Seller:** habilitação temporária e controlada; iniciar Seller OAuth, negar/aceitar, validar state/replay, troca, criptografia, lojas autorizadas e refresh com dados de teste.
9. **Pós-teste:** desabilitar flag se houver qualquer erro de isolamento, revogar conexão de teste se aplicável, coletar logs sanitizados e decidir próxima fase.

## Cenários E2E Sandbox obrigatórios

- Usuário com permissão inicia Seller OAuth no workspace A; workspace B não vê nem consome o state.
- Usuário nega; state fica terminal e não pode ser repetido.
- Callback com state expirado, ausente e repetido falha sem consulta de token.
- Token `user_type != 0`, escopos incompletos, resposta HTTP/API inválida e timeout não persistem credenciais.
- Aceitação válida persiste apenas ciphertext, escopos e metadados permitidos; `GET /authorization/202309/shops` fica associado ao workspace correto.
- Refresh concorrente: lease/fencing rejeita gravação atrasada; resposta ambígua marca reautorização quando necessário.
- Content Posting continua com Login Kit, callback e tokens próprios.

## Critérios de interrupção imediata

- Token, `auth_code`, App Secret, URL de token ou ciphertext aparece em log/resposta.
- State de A pode ser classificado, consumido ou persistido em B.
- Callback Content Posting falha após publicação do roteador.
- Migration/função remota diverge do commit aprovado.
- Partner Center não aceita a URI configurada ou o contrato retornado diverge do cliente.

## Aprovações manuais exigidas

| Ponto | Responsável sugerido | Evidência |
|---|---|---|
| Partner Center/Redirect URI/serviço | Proprietário do aplicativo TikTok Shop | Captura sanitizada e URL exata |
| Secrets backend | Administrador Supabase | Confirmação de presença, sem valores |
| Migration e Edge deploy | Responsável técnico + owner | Janela, backup e SHA aprovado |
| Habilitação temporária da flag | Owner do produto | Registro explícito de GO Sandbox |
| Go/No-Go pós-Sandbox | Segurança + engenharia + owner | Resultados E2E e logs sanitizados |
