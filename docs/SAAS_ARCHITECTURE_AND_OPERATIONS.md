# AutoClip — arquitetura SaaS e operação

## Auditoria de base (2026-10-31)

O frontend é uma SPA React/Vite hospedável na Vercel. Ele acessa o Supabase diretamente apenas com a chave pública, com RLS por workspace; operações sensíveis usam Edge Functions. O banco possui workspaces, papéis OWNER/ADMIN/EDITOR/VIEWER, auditoria e políticas para dados e objetos do bucket privado `media`.

O OAuth do TikTok é o fluxo Web oficial (`/v2/auth/authorize/`). O `state` é de uso único, tokens ficam somente no banco, cifrados com AES-256-GCM na Edge Function e vinculados ao identificador do canal. A renovação de token, publicação e consulta de estado acontecem no backend. Não há automação de login, cookies de sessão ou proxies para burlar limites.

As publicações são jobs persistentes. `claim_publication_jobs` usa bloqueio de linha com `SKIP LOCKED`; o worker persiste o `publish_id` antes do upload, usa retentativa e deixa resultado ambíguo como `UNKNOWN`, sem reenviar automaticamente. Vídeo usa upload oficial por arquivo; fotos/carrossel usam `PULL_FROM_URL` por URL temporária no domínio HTTPS verificado quando configurado. TikTok Shop é um pipeline separado e foi preservado.

O upload de mídia é direto do navegador para o Storage privado. O arquivo é validado no cliente, criado como `UPLOADING` e finalizado por RPC apenas se o objeto existir. O limite atual por vídeo é 50 MiB, alinhado ao bucket de desenvolvimento. Biblioteca, filtros, pré-visualização com URL assinada, CSV de agendamento e calendário já existiam.

## Entregas SaaS desta fase

A migration `20261102000001_saas_entitlements_and_media_retention.sql` introduz:

- planos configuráveis no banco (Starter, Pro, Advanced, Agency e Enterprise);
- assinatura por workspace, teste de 7 dias para workspaces novos e camada preparada para `MANUAL`, Stripe e Mercado Pago;
- ciclos de uso, reserva ao confirmar agendamento, conversão para consumo apenas em `PUBLISHED` e liberação em `FAILED`/`CANCELLED`;
- bloqueio transacional de novas conexões TikTok acima do limite do plano;
- histórico de eventos de assinatura e reserva de quota;
- página **Plano e consumo** para simular mudança/cancelamento em desenvolvimento. Ela não cria checkout e não cobra o usuário;
- indicadores de plano, quota e armazenamento no painel;
- configuração de retenção de mídia no workspace.

O downgrade nunca apaga contas, publicações ou mídia. Se o consumo existente exceder um limite novo, ele fica preservado e apenas novas operações ficam bloqueadas até o ciclo seguinte ou uma mudança de plano.

## Retenção e limpeza de mídia

A função `media-cleanup` é interna, protegida pelo mesmo `WORKER_SECRET` do worker de publicação. A decisão de elegibilidade ocorre no banco, nunca no navegador. Para um arquivo ser candidato ele precisa:

1. estar `READY` e pertencer ao mesmo workspace;
2. ter ao menos uma publicação `PUBLISHED` concluída há mais que o período de segurança;
3. não possuir rascunho, agendamento, processamento, retentativa, bloqueio ou resultado desconhecido que o referencie;
4. receber uma trava exclusiva antes da remoção. Novos agendamentos não aceitam mídia travada;
5. ser revalidado ao terminar o processamento.

O worker executa em lotes pequenos. Em dry-run, registra `DRY_RUN` na tabela `media_cleanup_audit` e libera a trava sem apagar o objeto. Em exclusão real, remove primeiro o objeto privado e só então marca a mídia como `DELETED`, com data e motivo. Falhas no Storage são auditadas e deixam a mídia disponível para reconciliação/retry. A tabela de auditoria mantém bytes, motivo e data; não guarda URLs assinadas, tokens ou credenciais.

Valores iniciais seguros por workspace:

| Configuração | Valor |
|---|---:|
| `auto_delete_media_enabled` | `false` |
| `auto_delete_media_dry_run` | `true` |
| `auto_delete_media_grace_hours` | `24` |
| `auto_delete_media_batch_size` | `10` |

O `pg_cron` só chama a função a cada 15 minutos quando ao menos um workspace habilitar a rotina. Portanto, aplicar a migration antes de publicar a Edge Function não causa chamadas remotas enquanto a configuração padrão estiver preservada.

### Homologação de limpeza

1. Aplique a migration em um projeto de homologação e publique `media-cleanup`.
2. Habilite **Executar limpeza automática**, mantendo **Modo de simulação** ligado.
3. Publique um vídeo de teste, aguarde a confirmação e o grace period.
4. Verifique `media_cleanup_audit` como administrador e confirme que não existem jobs ativos para o asset.
5. Só com autorização explícita, desative o dry-run. Nunca faça isso inicialmente em produção.

## Custos e limites de infraestrutura

No plano gratuito, os principais vetores são Storage/egress, banco, invocações e tempo das Edge Functions. O AutoClip reduz transferência pela Vercel ao fazer upload direto ao Supabase Storage, usa URLs assinadas curtas, processa a fila e limpeza em lotes, pagina listas e evita polling de arquivos no frontend. O painel expõe `storage_bytes` e `deleted_storage_bytes` como métricas internas calculadas — não são uma fatura do Supabase.

Para vídeos, não mude o método oficial atual sem um teste: upload de arquivo tende a transferir bytes via worker; `PULL_FROM_URL` exige domínio HTTPS verificado e hoje é usado para carrosséis. Um domínio próprio não é exigido em desenvolvimento, mas é uma dependência do TikTok para o fluxo de fotos em produção.

## Deploy e dependências

1. Execute `supabase db push` no projeto de homologação.
2. Execute `supabase functions deploy media-cleanup` com os segredos existentes `WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `TOKEN_ENCRYPTION_KEY`.
3. Faça build do frontend e configure apenas as variáveis públicas já existentes: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Não habilite cobrança: Stripe/Mercado Pago requerem produtos, webhooks assinados e credenciais reais, que não foram criados.
5. Não use Vercel Hobby para operação comercial. Migre de plano antes da comercialização, conforme os termos vigentes da Vercel e Supabase.

OAuth fora do Sandbox depende da aprovação do app TikTok. Enquanto estiver em Sandbox, somente contas adicionadas como Target Users podem conectar. A aprovação não concede promessa de resultado no Programa de Recompensas do Criador.

## Testes e recuperação

O front deve passar em `npm --prefix apps/web run typecheck`, `npm --prefix apps/web test` e `npm --prefix apps/web run build`. Os testes de banco são executados com `supabase test db` somente contra o stack local; não execute testes destrutivos contra produção. Testes de publicação devem mockar TikTok e Storage.

Em uma falha de limpeza, mantenha dry-run ativo, consulte `media_cleanup_audit`, verifique o status dos jobs e corrija/reexecute a função. Se a remoção do objeto ocorreu mas a atualização do banco falhou, a trava expira e a próxima execução faz a reconciliação idempotente. Nunca altere manualmente um job `UNKNOWN` para publicar; use o fluxo de reconciliação já existente.

## Evidências de homologação pós-deploy (2026-11-01)

Validação remota realizada sem upload para Storage, sem publicação para o TikTok e com transações de teste revertidas:

- A Vercel respondeu HTTP 200 e o bundle publicado contém as telas **Plano e consumo** e **Retenção de mídia**. Não havia sessão de navegador autorizada disponível para validar a navegação autenticada visualmente.
- Os cinco planos, uma assinatura Starter ativa e o ciclo de 120 publicações foram encontrados no banco. Uma transação temporária comprovou `RESERVED` na criação de um agendamento e `CONSUMED` após mudança para `PUBLISHED`; os registros temporários não permaneceram após `ROLLBACK`.
- Mídia fictícia publicada há 25 horas só ficou elegível depois da remoção de um job `UNKNOWN` compartilhado. O teste confirmou lock exclusivo, auditoria `DRY_RUN`, manutenção do status `READY` no dry-run e idempotência da finalização física simulada. O rollback impediu qualquer alteração persistente ou chamada ao Storage.
- O dry-run real da Edge Function retornou HTTP 200 com zero candidatos, zero dry-runs e zero objetos removidos. No ambiente atual não há histórico/mídia elegível, portanto ainda falta observar uma auditoria `DRY_RUN` persistente com um asset real de homologação.
- A função respondeu HTTP 401 sem `x-worker-secret`. A RPC de claim não tem execução para `anon` nem `authenticated`; apenas `service_role` a possui. As seis novas tabelas têm RLS ativo e políticas de leitura por workspace/papel.
- O cron `invoke-media-cleanup` está ativo a cada 15 minutos. Dois HTTP 500 foram registrados antes da correção de ambiguidade de `workspace_id`; após a migration `20261102000002_fix_media_cleanup_candidate_query.sql`, a resposta foi HTTP 200. `net._http_response` e `media_cleanup_audit` são os pontos de diagnóstico operacional.

## Evidências locais complementares (2026-11-01)

O stack Supabase local foi recriado com `supabase db reset`, aplicando todas as migrations até `20261102000002`. Em seguida, `supabase test db` passou integralmente: **8 arquivos e 93 testes**. As fixtures antigas de jobs ativos foram atualizadas para informar `music_rights_confirmed = true`, requisito já imposto pelo banco; o contrato de aprovação também passou a emitir TAP, eliminando um falso negativo do runner.

O script `scripts/test_local_concurrency.sh` abriu duas conexões PostgreSQL independentes contra o banco local. Com limite de ciclo igual a um, só uma inserção concorrente conseguiu reservar quota; a outra falhou de forma esperada. Em paralelo, uma transação manteve o claim de limpeza e a segunda recebeu zero candidatos por `FOR UPDATE SKIP LOCKED`. O script usa somente mídia fictícia sem objeto no Storage e remove o usuário/workspace de fixture no `trap` de saída.

O frontend também foi verificado no mesmo ciclo: `typecheck`, Vitest (**25 testes**) e build de produção passaram. O bundle ainda emite o aviso não bloqueante de chunk JavaScript acima de 500 kB.

Pendências de lançamento: validar a interface com uma conta de teste autenticada, registrar ao menos um candidato de homologação em dry-run persistente, configurar observabilidade/alerta externo para respostas não-2xx, concluir aprovação TikTok fora do Sandbox e configurar provedor de pagamentos/webhooks antes de qualquer cobrança.
