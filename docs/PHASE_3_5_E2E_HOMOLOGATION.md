# AutoClip — Fase 3.5: homologação E2E local

**Status:** parcialmente homologada. Execução local em 2026-11-01. Nenhum banco remoto, OAuth TikTok, publicação, deploy ou exclusão em produção foi acessado.

## Ambiente e proteção

- Supabase CLI local identificado por `supabase status -o env`; runner valida que `API_URL` e `DB_URL` usam `localhost`, `127.0.0.1` ou `::1`, e exige resposta saudável do Auth local antes de criar fixtures.
- O runner obtém `SERVICE_ROLE_KEY` somente em memória para setup/cleanup; a chave não é escrita em fixture, variável enviada ao browser, trace ou documentação. O browser recebe apenas URL/chave pública local e credenciais fictícias temporárias.
- Dados usam endereços `example.test`, senhas aleatórias em memória, nomes com prefixo E2E e IDs efêmeros. O cleanup remove objetos somente sob o prefixo do workspace criado pelo próprio runner, remove workspaces e apaga os usuários fictícios.
- Playwright Test 1.64.1, Chromium local gerenciado pelo Playwright, worker único, timeout 45 s, trace/screenshot/vídeo em falha, relatório HTML e JUnit. Projetos: desktop 1440×900 e mobile 390×844.
- Executar: `npm --prefix apps/web run test:e2e`. O comando falha fechado se Supabase local não estiver disponível. `npm --prefix apps/web run test:e2e:report` abre o relatório HTML.
- Backup/restore: `npm --prefix apps/web run test:local:backup-restore`; também exige API/DB local e identifica o container Supabase que publica a porta local 54322.

## Evidências executadas

### Navegador autenticado

Playwright foi executado com login real contra Supabase Auth local. Foram verificados login válido e inválido, rota privada redirecionada sem sessão, logout, páginas Painel/Biblioteca/Canais/Lotes em ambos os tamanhos, usuário VIEWER sem link administrativo, e RLS impedindo leitura de uma conta de outro workspace. A interface de grupos permitiu criar grupo fictício e vinculá-lo à conta. O wizard abriu, selecionou o grupo e a mídia fictícia e chegou à prévia.

O teste compara contagens de `publication_jobs` e `publication_quota_reservations` antes e depois de abrir e editar a prévia. Não há confirmação do lote no E2E; não foram criados jobs ou reservas pelo wizard. Não foi acionada a API TikTok.

Execução final isolada: **11 passaram, 0 falharam, 3 skips intencionais**, duração aproximada de 1m18s. Os skips correspondem aos cenários de wizard e upload/Storage binário no projeto mobile; esses cenários foram executados no Chromium desktop. Uma execução anterior em paralelo compartilhou fixtures, falhou e não foi contabilizada. A repetição isolada passou.

### Supabase Storage binário

Fixtures reais foram geradas localmente com FFmpeg: JPEG, PNG e WebP de 360×360, e MP4 H.264 curto. A interface fez upload real de PNG autenticado e o item apareceu na biblioteca. O teste autenticado direto à API Storage validou upload/listagem/download dos quatro formatos, URL assinada, bucket privado, rejeição de `text/plain`, upload anônimo recusado, acesso assinado a arquivo de outro workspace recusado, e sobrescrita com `upsert:false` recusada. Arquivo com 50 MiB + 1 byte foi rejeitado pelo limite do bucket. Objetos de teste são removidos ao final do teste local.

**Limitação comprovada:** Storage aceitou uma sequência de texto enviada com `Content-Type: image/png`. O serviço aplica o MIME declarado e o limite, mas não inspeciona assinatura/conteúdo. A interface usa decodificação da imagem no browser para obter dimensões e rejeita bytes que não decodificam, mas isso não protege chamadas diretas autenticadas à Storage/RPC. Antes de operar com upload não confiável, exigir validação server-side do conteúdo em fluxo próprio; não considerar o bucket um scanner de arquivo.

Não foi testada fixture MOV nem codec/limites completos do TikTok. Upload negativo com MIME permitido mas bytes inválidos foi observado aceitar na API do Storage, conforme acima.

### Backup e restauração PostgreSQL

O ensaio local passou. Foi preparado workspace fictício com uma conta, grupo e membro, metadado de mídia, lote, job terminal `FAILED`, ciclo de quota e auditoria. Dump custom criado com `pg_dump` PostgreSQL 17.6 do container local, sem owner/ACL; arquivo de 532.956 bytes em `/tmp/autoclip-pg-restore-79b1f05f-jqfI0z/local.dump`. Restaurado em banco isolado `autoclip_restore_79b1f05f` dentro do container local e descartado depois da verificação. Duração total 2.220 ms; restauração 1.375 ms.

Após restaurar: workspace=1, channel=1, group=1, media=1, batch=1, job=1, ciclo=1, evento de auditoria=1, órfãos de FK=0; RPC `list_publication_batches` presente. Consulta foi feita no banco restaurado.

A primeira restauração falhou porque a extensão `pg_cron` local só pode ser criada no DB `postgres`; o dump foi ajustado para excluir essa extensão do ensaio isolado. Um segundo bloqueio revelou que o papel local `postgres` não é superuser e não pode definir parâmetros de funções Realtime; restauração executada com `supabase_admin`. Essas falhas intermediárias foram corrigidas sem mexer na base de origem. O artefato de dump é temporário e não está no repositório.

O dump cobre PostgreSQL, não os bytes do Storage, configuração do projeto, secrets, configuração de OAuth/provedores nem arquivos externos. A exclusão de `pg_cron` é específica ao banco alvo isolado: jobs e extensão de cron precisam ser provisionados/restaurados separadamente no banco operacional apropriado.

## Resultados Playwright

Transcrever da execução final isolada após `npm run test:e2e`:

| Projeto | Cenários | Resultado |
|---|---|---|
| Chromium desktop 1440×900 | login, navegação, grupo/wizard, isolamento, upload e Storage | 7 aprovados, 0 falhas; screenshot de Lotes em `apps/web/test-results/` |
| Chromium mobile 390×844 | login, navegação/responsividade, isolamento | 4 aprovados, 3 skips por duplicação planejada; screenshot de Lotes em `apps/web/test-results/` |

Evidências de falha são salvas em `apps/web/test-results/`; relatório em `apps/web/playwright-report/`. Ambos são ignorados pelo Git.

## Não executado / pendente

- Sessão expirada por tempo, alternância real entre workspaces pela UI, CSV E2E, carrossel até confirmação, repetição de lote, cancelamento, reagendamento, dashboard com conteúdo, e exportação CSV não foram percorridos de ponta a ponta pelo browser nesta suíte.
- Não foi confirmado visualmente o limite de quota via tentativa de confirmação; E2E intencionalmente não confirma lotes.
- OAuth/creator_info e permissões reais dependem de app TikTok aprovado e continuam fora do escopo local.
- Não houve verificação cross-origin de navegador em dispositivos reais; mobile usa emulação Chromium.
- Regressão final executada nesta fase: Typecheck aprovado; Vitest 45/45; build de produção aprovado; worker 25/25; `supabase db reset` local aplicou 24 migrations; pgTAP 10 arquivos/129 asserções; concorrência local aprovada; `npm audit --omit=dev` sem vulnerabilidades; `git diff --check` após correção da documentação.

## Artefatos e comandos

Os pacotes Playwright estão em `apps/web` e lockfile atualizado. Fixtures e scripts estão em `apps/web/e2e`; não contêm credenciais. Relatórios e resultados ficam ignorados em Git.

```bash
npm --prefix apps/web run test:e2e
npm --prefix apps/web run test:local:backup-restore
```

O modo dry-run da retenção não foi alterado. Nenhum dado de cliente ou conteúdo TikTok foi usado.

## Adendo — Fase 3.5.1

O fluxo de Storage desta documentação histórica foi endurecido em `docs/PHASE_3_5_1_STORAGE_HARDENING_AND_E2E.md`: upload vai para quarentena e somente imagens JPEG/PNG/WebP decodificadas server-side recebem atestado READY. A antiga evidência de upload de MP4 descreve apenas a configuração anterior do Storage, não a capacidade atual de aprovação de mídia. Vídeos foram bloqueados fail-closed até existir decodificação server-side segura.

Na execução final da Fase 3.5.1, Playwright passou 20/20 em desktop e mobile; pgTAP passou 138 testes; reset local, concorrência, worker e ensaio backup/restore também passaram. A fase continua **parcialmente homologada** pela limitação de vídeo e pela necessidade de tratar mídia legada `UNVERIFIED` antes de qualquer aplicação remota.
