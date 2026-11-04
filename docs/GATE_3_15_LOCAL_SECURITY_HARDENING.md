# Gate 3.15 — hardening local de segurança e validação

## Resumo

Foram implementadas correções **somente no repositório e no Supabase local** para as RPCs de alteração manual de plano e resolução de publicação `UNKNOWN`. O novo migration é `20261103000009_harden_manual_plan_and_unknown_resolution.sql`; ele não foi aplicado ao Cloud. A role `autoclip_cloud_auditor` não foi modificada e permanece documentada como `NOLOGIN`.

SHA-256 do migration: `d8ee12ef377d0147c5784874227b19dd8365eabd986b187f87c344d3de566e19`.

Não houve conexão ao Cloud, alteração remota, deploy, publicação TikTok, cobrança, limpeza física de mídia, commit ou push. Os relatórios de produção não foram consultados novamente.

## 1. Alteração de planos

`public.change_workspace_plan(uuid,text)` agora exige identidade `service_role` ou `public.is_platform_owner()`. Ser OWNER/ADMIN de um workspace não basta. A função bloqueia assinatura ausente e assinatura gerenciada por provedor de cobrança, valida plano ativo, bloqueia a assinatura durante a alteração e registra o operador em `subscription_events`. Não cria evento de pagamento nem simula checkout. Planos, consumo e visão de quota continuam consultáveis pelas rotas existentes.

A interface mantém a consulta de planos/consumo, mas só mostra a ação de alteração manual ao operador global reconhecido por `usePlatformOwner`. A autorização final continua no PostgreSQL; o estado da interface não é uma fronteira de segurança.

O teste verificou OWNER, ADMIN, EDITOR, VIEWER e usuário de outro workspace negados; operador da plataforma e `service_role` autorizados; plano inexistente negado; e ausência de UPDATE direto em assinaturas/ciclos por `authenticated`. Os grants de leitura foram preservados.

## 2. Resolução de jobs `UNKNOWN`

`public.resolve_unknown_job` passa a aceitar `p_request_id uuid`, além do job e resultado. Só OWNER/ADMIN do workspace ou `service_role` pode resolver. A RPC mantém o lock do job, valida `UNKNOWN` e restringe o resultado a `PUBLISHED` ou `NOT_PUBLISHED`. Cada resolução grava uma chave única, ator, workspace, job e resultado na tabela sem leitura/escrita direta pelos roles de cliente; o evento de auditoria inclui o mesmo request ID.

Repetir o mesmo request ID, ator, job e resultado retorna sucesso sem repetir a transição nem duplicar o evento. Reutilizar a chave com payload incompatível falha; uma nova chave após a transição também falha porque o job já não está `UNKNOWN`. O cliente web mantém a chave em memória durante retries na mesma instância do modal. Após reload, se a primeira transação tiver sido confirmada, o estado do job impede uma segunda resolução.

`JobDetail` oculta a ação de EDITOR/VIEWER e envia um UUID por tentativa lógica. A autorização no banco permanece obrigatória, inclusive contra chamadas diretas à RPC.

## 3. `pg_net`

Nenhuma ACL da extensão foi alterada em migrations locais. As evidências anteriores confirmam ACLs de `PUBLIC` relevantes, mas não provam se `net` está exposto via PostgREST, qual identidade efetiva executa `net.http_post` dentro dos wrappers SECURITY DEFINER nem se uma revogação preservaria cron/worker/cleanup.

Proposta para um gate posterior: confirmar schemas expostos pela Data API; mapear owner e privilégios efetivos dos wrappers e rotinas; reproduzir cron → `pg_net` → Edge Function em sandbox; então avaliar restrição da exposição e ACLs por objeto/principal. Não fazer REVOKE global de `PUBLIC` sem prova do chamador e ensaio de regressão. Neste Gate, o item segue **pendente de investigação**, sem SQL de correção.

## 4. Oito migrations anteriormente `LOCAL_ONLY`

Foi criado um projeto Supabase local descartável, com cópia das migrations atuais e portas próprias, e todas as migrations 01–08 mais a nova 09 foram aplicadas desde uma base limpa. A suíte pgTAP completa passou: **15 arquivos / 220 testes**. O banco persistente `tiktok-saas` não foi resetado; a migration 09 foi aplicada aditivamente nele para validar a mudança local. A versão do PostgreSQL usada pelo Supabase local é 17.6, não a Cloud 17.11.

As oito migrations foram verificadas nessa cadeia completa:

1. `20261103000001_account_groups_and_publication_batches.sql` — grupos e lotes; FKs/policies/RPCs.
2. `20261103000002_batch_management_and_carousels.sql` — operações de lote e carrosséis.
3. `20261103000003_allow_image_media_uploads.sql` — allowlist de imagens no bucket `media`.
4. `20261103000004_secure_media_validation_pipeline.sql` — quarantine, backfill de mídia, políticas e RPCs de validação.
5. `20261103000005_video_validation_and_legacy_revalidation.sql` — leases/estados de validação, revalidação e cleanup compatível.
6. `20261103000006_video_worker_heartbeat.sql` — heartbeat do worker e RPC interna.
7. `20261103000007_video_worker_api_credentials.sql` — nonce e prevenção de replay da API do worker.
8. `20261103000008_gate_video_validation_on_storage_upload.sql` — confirmação de upload antes da fila.

Dependência: 01→02; 03 e 04 estabelecem uploads/quarantine; 05 depende da 04; 06 acompanha o worker; 07 depende do pipeline de validação; 08 depende do ciclo de upload e validação. A aplicação limpa confirma compatibilidade de sequência e sintaxe nesse ambiente, não confirma desempenho sob carga, locks aceitáveis em Cloud, equivalência de dados, configuração real de Storage, compatibilidade de Edge implantado ou segurança runtime. Migrations normais são de execução única via ledger, não scripts idempotentes para repetição manual.

A migration 09 remove a assinatura antiga de dois argumentos de `resolve_unknown_job` e introduz a assinatura com `p_request_id`. Frontend antigo deixará de resolver jobs depois dessa mudança. Qualquer rollout futuro exige corte coordenado do bundle web e da migration, plano para clientes com bundle antigo e confirmação de atualização do schema cache PostgREST; não aplicar a migration isoladamente.

### Riscos de rollout e reversão

- As migrations 04/05/08 alteram o fluxo de upload e podem bloquear mídias até Edge/worker compatíveis estarem disponíveis.
- Migration 04 atualiza linhas de `media_assets` existentes; tamanho, WAL e duração em Cloud não foram medidos.
- Bucket/configuração Storage e PostgreSQL não formam uma transação distribuída.
- Índices, constraints e revogações podem causar locks ou incompatibilidade temporária com clientes antigos.
- Nonces, atestados e objetos da quarantine podem perder valor operacional se removidos.

Não há rollback down seguro aprovado. Plano futuro: backup restaurável de DB e inventário/configuração de Storage; janela coordenada; parar consumidores conforme ensaio; avançar migration por migration com health checks e fila observada. Em falha, interromper a sequência e preferir correção forward. Restauração só após ensaio em sandbox, não executar DROP para tentar reverter estado parcial.

A migration 09 também não tem script down aprovado. Se uma implantação futura falhar após o commit, reconciliar o estado e usar correção forward; não recriar automaticamente a RPC antiga nem remover a tabela de idempotência, pois isso pode reabrir caminhos de autorização ou replay.

## 5. Testes e validações

Checklist exercitado no pgTAP: usuário de outro workspace, VIEWER, EDITOR, OWNER e ADMIN; operador de plataforma; caminho interno `service_role`; tentativas de upgrade por workspace admin; plano inválido; escrita direta em quota/assinatura; workspace cruzado em resolução; papéis e transições permitidos/proibidos; request ID nulo, replay idêntico, chave reutilizada com payload diferente e nova resolução após mudança de estado; reserva mantida/consumida e trilha de auditoria sem duplicação.

- Supabase local descartável, migrations 01–09 desde zero: sucesso.
- pgTAP no ambiente descartável: 15 arquivos, **220/220** aprovados.
- pgTAP direcionado no `tiktok-saas` local após aplicar migration 09 aditivamente: `15_rpc_security_triage` e `02_tiktok_integration` passaram, **82/82**.
- Vitest: 5 arquivos, **45/45** aprovados.
- TypeScript: `npm run typecheck --prefix apps/web` passou.
- Build Vite: `npm run build --prefix apps/web` passou.
- `supabase db lint` no ambiente isolado, `--fail-on error`: sem erro bloqueador. Foram reportados avisos preexistentes em `delete_platform_user`, funções de validação/cleanup e funções internas de Storage; não foram corrigidos neste gate.
- `git diff --check` e referências Markdown dos documentos atualizados passaram.
- Testes não publicaram no TikTok, não usaram dados de clientes e não acessaram Cloud.

Não foi feito ensaio multi-sessão concorrente da mesma chave; a garantia de serialização por lock de linha e unicidade da chave foi revisada no código, mas precisa de teste concorrente antes de homologação.

## 6. Riscos residuais e homologação

1. **Alto — `pg_net`:** ACL pública observada; alcance por API, egress e compatibilidade de cron não demonstrados. Não corrigido por falta de prova suficiente para reduzir ACL sem regressão.
2. **Alto — corpo implantado:** as RPCs Cloud e demais funções não foram comparadas ao código local. A migration 09 ainda não está no Cloud.
3. **Alto — Storage/RLS:** aplicação local das migrations passou, mas políticas e uploads não foram exercitados com dois tenants reais em um staging autorizado; configuração Cloud permanece conforme evidência anterior, sem nova verificação.
4. **Alto — rollout de mídia:** requer coordenação de bucket, Edge Function, worker e frontend; a sequência nova ainda não foi implantada.
5. **Médio/alto — jobs `UNKNOWN`:** o novo controle exige Admin/Owner, mas a confirmação externa continua manual. Um operador autorizado ainda pode decidir incorretamente que houve ou não publicação.
6. **Médio — concorrência/escala:** lock por job e chave idempotente foram testados sequencialmente; não foi feito teste de carga ou de concorrência multi-sessão nesta etapa.
7. **Pendente — billing:** seleção manual é restrita ao operador da plataforma e a assinaturas `MANUAL`; cobrança real permanece desativada e fora do escopo.
8. **Médio — compatibilidade de cliente:** a assinatura antiga da RPC é removida; bundle web anterior recebe erro de API durante a resolução. A implantação precisa ser coordenada e aprovada em gate próprio.

## 7. Critérios antes de homologação

- Comparar no Cloud os corpos e grants das RPCs após autorização específica.
- Decidir tratamento de `pg_net` apoiado por teste de dependências em sandbox.
- Revisar e aprovar migrations por arquivo/hash, com backup DB/Storage comprovadamente restaurável.
- Coordenar deploy de Edge/worker/frontend com as migrations de validação e quarentena.
- Testar RLS e Storage allow/deny com workspaces sintéticos A/B.
- Adicionar teste concorrente multi-sessão de request ID e transição de quota.
- Confirmar monitoramento, logs minimizados, rollback e recuperação de filas.
- Manter billing, publicação real e cleanup físico desativados até autorização própria.

**Decisão:** hardening local implementado e validado; sem aprovação para deploy, aplicação Cloud ou homologação real. A próxima etapa depende da revisão deste diff e da autorização separada para qualquer mudança Cloud.
