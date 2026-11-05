# Checklist para ativação do piloto

## Gate de autorização e alvo

- [ ] Proprietário confirma explicitamente project ref e ambiente Supabase.
- [ ] Escopo read-only e janela aprovados antes da auditoria.
- [ ] Credencial temporária/dedicada com privilégios mínimos; sem service role ou token amplo.
- [ ] Project ref/host e identidade do preflight conferidos por duas pessoas.
- [ ] Auditoria encerra se role tiver escrita, CREATE, BYPASSRLS ou associação privilegiada.

## Estado e segurança

- [ ] Ledger remoto comparado com 29 arquivos locais e conteúdo revisado.
- [ ] Schema, constraints, funções/RPCs, grants, triggers e search_path comparados.
- [ ] RLS validada em cada tabela de tenant; testes negativos permanecem locais.
- [ ] Buckets privados e policies/limites comparados; sem download de objetos durante inventário.
- [ ] Edge Functions implantadas e configuração de autenticação verificadas por leitura.
- [ ] Auth redirects/provedores/sessão revisados; sem exportar usuários.
- [ ] Vercel project, build/commit/domínios e presença de envs revisados sem valores.
- [ ] Secrets worker rotacionados/instalados por canal seguro; nunca registrados em logs.

## Mídia, jobs e integridade

- [ ] Inventário legado somente leitura concluído, agregados por workspace.
- [ ] UNVERIFIED, objetos ausentes, jobs futuros/retry/UNKNOWN/SENT_TO_INBOX e reservas quantificados.
- [ ] Plano individual para revalidação e reconciliação aprovado; nenhuma execução automática.
- [ ] Backup PostgreSQL e plano separado para bytes de Storage verificados.
- [ ] Quotas, jobs, lotes e históricos reconciliados sem mutação durante auditoria.
- [ ] UNKNOWN e SENT_TO_INBOX não contados como publicação confirmada.

## Operação e rollout

- [ ] Pendências worker local: linger/reboot, concorrência de duas instâncias e falha durante promoção resolvidas ou mitigadas.
- [ ] Compatibilidade do worker Cloud comprovada; heartbeat recente e health APIs verificadas.
- [ ] Rollout por etapas com janela, observação, critérios de parada e responsável nomeado.
- [ ] Estratégia de rollback forward-fix/backups revisada; Storage não recuperável só por pg_restore.
- [ ] Smoke tests limitados e sem publicar TikTok; aprovação externa TikTok obtida separadamente.
- [ ] Nenhuma cobrança real habilitada; checkout continua fase final.

## Estado atual

O alvo de projeto identificado é `Autoclip` (`djrwfvcxgpyknmizqumn`), mas o ambiente produção/staging não foi confirmado e falta credencial PostgreSQL read-only. Todos os itens Cloud permanecem pendentes. Esta fase não concede aprovação para piloto, deploy, migrations, upload, OAuth ou publicação.
