# Runbook de publicação e rollback — Seller OAuth

**Uso:** somente após aprovação explícita de Sandbox. Este documento não é autorização para executar comandos.

## Princípios

- Não habilitar `TIKTOK_SHOP_ENABLED` antes do endpoint autenticado Seller Start, revisão de callback e homologação Sandbox.
- Não incluir secrets em arquivos, output de CI, logs ou tickets.
- Não confundir Preview Vercel com deploy de Edge Function Supabase.
- Não publicar migration, função ou flag sem ponto de rollback, backup e responsável definido.

## Pré-requisitos e evidências

1. SHA aprovado e PR mergeado; identificar SHA exato no change record.
2. Backup/restauração do projeto Supabase confirmados pelo administrador. Estado atual é **não verificado**.
3. Inventário remoto de migrations e Edge Functions obtido em modo leitura; comparar com o SHA.
4. Partner Center confirma Redirect URI, service ID e escopos para Sandbox.
5. Secrets backend necessários presentes, sem expor valores.
6. Endpoint/UI Seller Start revisados e flag ainda `false`.
7. Janela de manutenção, monitoramento, responsável técnico e owner de rollback definidos.

## Ordem de publicação proposta

1. Aplicar migrations Seller aprovadas no ambiente Sandbox, uma vez, monitorando erros de constraints/RLS/RPC.
2. Verificar em modo leitura: tabelas, RLS, grants, funções e versão das migrations.
3. Publicar Edge Functions aprovadas, inclusive callback compartilhado e endpoint Seller Start quando existir.
4. Fazer smoke de Content Posting antes de tocar na flag Seller.
5. Configurar somente os secrets de backend necessários e confirmar presença.
6. Com aprovação explícita, habilitar Seller somente no ambiente Sandbox pelo mecanismo de feature flag revisado.
7. Executar cenários E2E da matriz GO/NO-GO e manter logs sanitizados.

## Smoke tests Content Posting pós-publicação

- Abrir fluxo `tiktok-channel` com usuário autorizado e confirmar criação de state Content.
- Cancelar e concluir callback com conta de teste conforme permitido; confirmar state uso único.
- Confirmar que `/tiktok/callback` continua removendo `code/state` do histórico.
- Confirmar que Content não consulta/consome state Seller quando flag está desligada.
- Verificar que agendamento, worker e refresh existentes não sofrem alterações de schema/permissão.

## Monitoramento

Monitorar sem material sensível:

- taxa de `invalid_state`, `authorization_denied`, `authorization_failed` e `callback_unavailable`;
- erros de RPC/RLS, falhas de cifragem e conflitos de lease/fencing;
- erros de token HTTP/429/timeout classificados, sem URL/token;
- auditoria Seller por `correlation_id` e workspace, quando correlação explícita for adicionada;
- saúde das Edge Functions e de banco após migration.

## Rollback sem perda de dados

1. **Interromper novas autorizações:** manter/desativar a feature flag fail-closed. Não apagar conexões ou credenciais automaticamente.
2. **Edge Function:** republicar a versão anterior conhecida do callback apenas se ela for compatível com o schema já aplicado; caso contrário, manter resposta fail-closed até corrigir.
3. **Migrations:** migrations já aplicadas não devem ser revertidas destrutivamente. Criar migration corretiva/compatível após análise. Restaurar backup somente com aprovação de incidente e impacto avaliado.
4. **Secrets:** não rotacionar ou remover de forma reativa sem avaliar conexões existentes; registrar incidente e usar procedimento de rotação aprovado.
5. **Dados:** preservar `seller_audit_events`; não excluir credentials/connections para “limpar” falha. Marcar reautorização necessária pelo fluxo revisado quando confirmado.
6. **Content Posting:** se regressão for observada, priorizar restauração do callback Content e manter Seller desativado.

## Critérios de saída da janela

- Todos os E2E Sandbox previstos aprovados ou documentados como bloqueados.
- Sem vazamento de segredos/codes/tokens e sem cruzamento entre workspaces.
- Content Posting smoke aprovado.
- Sem erro crítico de RLS, migration ou Edge Function por período acordado.
- Owner registra GO/NO-GO da próxima etapa.

## Estado atual

Este runbook é preparatório. Não foram verificados backups, migrations remotas, Edge Functions remotas, secrets, configurações Vercel, Partner Center ou Sandbox nesta auditoria.
