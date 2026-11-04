# Gate 3.12 — plano de homologação integrada

## Estado e objetivo

Plano para ambiente isolado de homologação, ainda não executado. O projeto Cloud é o único ambiente principal; não usar produção como staging. Homologação real exige ambiente/cópia e autorização do proprietário, contas sintéticas e credenciais de teste. O estado da role auditora em diagnóstico anterior foi NOLOGIN; isso não valida a aplicação. Checkout e cobrança ficam fora desta fase.

## Critérios de entrada

- Comparação local/Cloud autorizada concluída ou diferenças explicitamente aceitas; migrations revisadas individualmente, backup restaurável e aprovação separada para qualquer aplicação.
- Nenhuma vulnerabilidade crítica aberta; riscos altos de RLS, service role, `pg_net`, Storage, OAuth, idempotência e recuperação mitigados ou impeditivos formalmente aceitos para o ambiente isolado.
- Usuários, workspaces, canais e mídias fictícios; nenhuma credencial ou mídia real.
- Auth, RLS/grants, funções privilegiadas, bucket privado, flags de Edge Function e secrets conferidos sem revelar valores.
- Worker monitorado, fila/retry/idempotência exercitados, alertas e rollback testados. App TikTok e contas de teste aprovados; operação externa somente com autorização específica.
- Responsável, janela, observabilidade, suporte, retenção e interrupção definidos. Não liberar usuários reais por aprovação deste plano.

## Cenários

| Cenário | Pré-condições e ambiente | Passos sintéticos | Resultado/evidência de aprovação | Bloqueio e recuperação |
|---|---|---|---|---|
| 1. Auth | projeto isolado, dois usuários/workspaces | login, logout, recovery, sessão expirada, troca de workspace, remover membership | eventos redigidos; sessão e acesso revogados conforme esperado; nenhum cruzamento | qualquer sessão ou dado acessível após revogação bloqueia; suspender teste e rever Auth/RLS sem tocar produção |
| 2. Multicontas | app/contas TikTok de teste autorizadas | conectar, renovar, desconectar e tentar usar canal do workspace B desde A | tokens somente servidor; associação e autorização coerentes | token/log exposto ou cross-tenant bloqueia; revogar credenciais de teste pelo procedimento aprovado |
| 3. Agendamento | quotas sintéticas, relógio controlado | agendar, disputar última quota, cancelar, reagendar e repetir request | reserva/consumo único, estado consistente e idempotente | quota negativa/duplicada ou job duplicado bloqueia; restaurar fixture e reconciliar no ambiente isolado |
| 4. Lotes | CSV fictício e múltiplos canais sintéticos | seleção, CSV válido/inválido, lote parcialmente inválido, retry e repetição | validação por linha, atomicidade documentada e sem IDs de outro tenant | mutação parcial não prevista ou referência cruzada bloqueia; limpar somente fixtures isoladas |
| 5. Publicação | app/API TikTok de homologação, mídia sintética aprovada | Direct/Inbox, consultar status, confirmar externamente, consumir quota e registrar histórico | sucesso somente com status externo confirmado; Inbox/UNKNOWN não equivalem a publicado | retry que possa duplicar bloqueia; pausar worker e reconciliar antes de reenviar |
| 6. Falhas | endpoints simulados ou ambiente de teste controlado | timeout antes/depois do aceite, 429, 5xx, token expirado, retry, falha definitiva | backoff/limites; estado ambíguo reconciliado; nenhuma duplicação | retry ilimitado ou sucesso local falso bloqueia; suspender fila sintética e conservar evidência |
| 7. Storage | bucket de homologação privado e objetos fictícios | upload, acesso permitido/negado, URL assinada, grace period e cleanup em dry-run; falha entre delete e RPC | escopo por workspace, retenção e reconciliação provados; nenhum objeto prematuro removido | URL pública/exclusão indevida bloqueia; manter cleanup desligado, não tentar apagar produção |
| 8. Segurança | dois workspaces sintéticos e observabilidade | negativos de RLS, RPC privilegiada, grants, `pg_net`, payload inválido e chamadas não autorizadas | sem leitura/mutação cruzada; evidências sem tokens/PII; mudança rastreável | qualquer bypass, função externa ou exposição bloqueia; conter no ambiente isolado, sem revogação global automática |

## Critérios de saída

- Todos os testes obrigatórios aprovados com evidência rastreável e build/artefato identificado.
- Sem falhas abertas de isolamento, duplicação, perda de quota, promoção inválida de mídia ou segredo em logs.
- Backup/restauração de banco e Storage testados separadamente e em conjunto, em destino isolado.
- Worker sobrevive a reboot/rede, recupera leases e emite métricas/alertas; processo manual de reconciliação exercitado.
- Estado remoto observado corresponde ao código aprovado; rollout/rollback e aprovações separados.
- Aprovação formal do proprietário para o escopo de piloto. Ainda assim, não implica checkout/cobrança nem liberação ampla de usuários.

## Evidência adicional Gate 3.12.1 — worker local

A primeira reprodução confirmou que um worker Compose persistente no mesmo Supabase local compartilhava a fila: o log do container exclusivo do E2E estava vazio enquanto a instância persistente tinha concluído a fixture. O teste agora recusa, antes de criar fixtures, workers externos ONLINE/DEGRADED com heartbeat recente; aguarda o heartbeat inicial da instância sob teste; exige `last_completed_at` na mesma instância; e consulta logs após a confirmação persistida. Em três execuções isoladas o cenário passou; com o worker persistente ativo, a recusa foi testada. Isso não prova ausência definitiva de flakiness nem homologa o worker em Cloud/produção.

Na reprodução, o worker persistente registrou `last_completed_at=2026-11-02T03:54:26.929Z`, antes do container exclusivo iniciar em `2026-11-02T03:54:31.566Z`; o stdout desse container tinha zero bytes. Regressões depois da correção: 45 testes Vitest, typecheck, 24 testes Node de auditoria e smoke Compose aprovados. A suíte pgTAP completa não foi executada.

## Rollback e limites

Usar somente mecanismos ensaiados no ambiente de homologação; preservar evidências, interromper workers e credenciais de teste conforme procedimento aprovado. Não aplicar down migrations automaticamente nem restaurar sobre produção. Publicação TikTok real, deploy, alteração Cloud e cobrança não são autorizados por este plano.

## Dependências externas

O fluxo deve continuar aderente à documentação oficial atual da [TikTok Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web), [gestão de tokens](https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens), [Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started) e [consulta de status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status). Revalidar escopos, requisitos de UX, limites e estados na data da homologação; documentação externa pode mudar.
