# Gate 3.19.1 — Rotação de tokens OAuth

## Escopo e contrato

Revisão e testes locais para impedir renovações concorrentes da mesma conexão TikTok. Nenhuma API autenticada, conta real ou projeto Cloud foi acessado.

Em 2026-11-02, a documentação pública atual do TikTok Login Kit consultada informa access token de duas horas, refresh token de 180 dias e substituição do refresh token após refresh bem-sucedido. A data de vigência específica de 2026-12-01 não foi localizada/confimada nas páginas consultadas; ela permanece requisito informado, não confirmação independente. A página de gerenciamento legada ainda exibe valores antigos; por isso, a implementação toma como referência o endpoint atual `open.tiktokapis.com/v2/oauth/token/` e registra a divergência documental. Fontes: [Get a User Access Token](https://developers.tiktok.com/docs/en/oauth-get-user-access-token), [User Access Token Management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management?enter_method=left_navigation), [OAuth Error Handling](https://developers.tiktok.com/docs/en/oauth-error-handling). A documentação descreve `invalid_grant` com causas distintas; o cliente trata falhas após envio como ambíguas e exige nova autorização.

O requisito fornecido para 2026-12-01 foi confrontado com essas fontes. O endpoint atual confirma os tempos e a rotação para Login Kit. Não foi encontrada confirmação suficiente para prometer recuperação automática após resposta perdida: se o TikTok invalidar o refresh antigo antes de a aplicação persistir o novo, o fluxo marca a conexão para reautorização.

TikTok Shop usa endpoint e contrato separados. A fonte pública do TikTok Shop indica ciclo de refresh próprio (refresh do access token a cada sete dias e refresh token atualizado no ciclo de seis dias), mas os campos/expirações exatos da resposta e semântica de timeout não ficaram plenamente confirmados. Não misturar esse contrato com Login Kit; confirmar endpoint e resposta na documentação oficial do app antes de staging. Fonte consultada: [TikTok Shop Partner Center](https://partner.tiktokshop.com/openlearn/guide/usecase?parent_id=7256668359047251713).

## Arquitetura local

Migration local `20261103000010_tiktok_refresh_rotation_leases.sql` acrescenta versão monotônica e estado `READY | IN_FLIGHT | REAUTH_REQUIRED`. RPCs SECURITY DEFINER com `search_path=''` e EXECUTE restrito a `service_role` adquirem lease persistente, concluem por compare-and-swap e marcam resultado ambíguo como reautorização. Locks SQL terminam antes de qualquer HTTP; nenhuma transação fica aberta durante chamada externa.

O worker grava access token cifrado, refresh token rotacionado, expirações, scopes e incremento de versão na mesma RPC/commit. Uma resposta tardia com versão ou attempt antigo não pode gravar. Reconexão OAuth reseta a lease e incrementa a versão atomicamente. O mesmo padrão foi aplicado ao fluxo Shop porque havia dois consumidores distintos que renovavam diretamente.

Workers concorrentes aguardam brevemente a versão nova; não disparam outro refresh enquanto a lease estiver ativa. Uma lease vencida não é tomada como licença para repetir o refresh token antigo: o estado passa a `REAUTH_REQUIRED`. Respostas incompletas e falhas de rede, timeout, descriptografia ou persistência após possível envio também são conservadoras. Se a resposta RPC se perder depois do commit, o cliente lê a versão persistida e reutiliza o access token somente se a nova geração estiver confirmada.

## Limitações e riscos

- Resultado remoto indeterminado pode exigir que o usuário reconecte a conta; não existe recuperação automática comprovada para refresh token rotacionado e perdido.
- Se uma falha local de criptografia ocorrer após a resposta do provedor, a lease permanece até expirar; então o fluxo pede reautorização.
- O timeout de lease é 90 segundos; tarefas acima do limite podem levar a reautorização conservadora.
- A API Shop usa parâmetros de credencial na URL conforme o endpoint já existente; verificar política de logs/telemetria do provedor e confirmar endpoint oficial antes de staging.
- A migration 10 é local-only e ainda não implantada no Cloud. Código novo não é compatível com schema remoto anterior até rollout coordenado.
- Nenhuma chamada real foi executada; evidência de contrato é documental e sujeita a mudança do provedor.

## Testes

Ver `GATE_3_19_1_CONCURRENCY_TESTS.md` e `GATE_3_19_1_VALIDATION_REPORT.md`. Os testes usam tokens fictícios, mocks HTTP e PostgreSQL descartável.
