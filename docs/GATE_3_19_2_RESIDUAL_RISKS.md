# Gate 3.19.2 — Riscos residuais

| ID | Risco/estado | Evidência e impacto | Severidade | Ação/critério de encerramento |
|---|---|---|---|---|
| R1 | Contratos Login Kit inconsistentes entre páginas oficiais | Uma página atual informa 2h/180d e rotação imediata; outra mantém 24h/365d | ALTO | Confirmar contrato aplicável ao app/ambiente e monitorar mudança. |
| R2 | Shop refresh response e semântica não confirmadas integralmente | Guia Partner Center parcial; token/secret passam na query da implementação | ALTO | Obter documentação oficial completa, revisar logs e testar em staging autorizado. |
| R3 | M10/M11 não implantadas no Cloud | Migrations locais; fotografia anterior Cloud antecede alterações | CRÍTICO para rollout, não vulnerabilidade Cloud demonstrada | Reconciliar e autorizar staging antes de qualquer deploy. |
| R4 | RPCs Cloud podem estar nas assinaturas/corpos antigos | Snapshot Gate 3.18 divergia da migration local 09 | ALTO | Comparar assinatura, corpo, grants e testes remotos autorizados. |
| R5 | pg_net PUBLIC EXECUTE observado | 12 rotinas; execução efetiva condicionada a schema USAGE e contexto | ALTO potencial | Analisar ACL efetiva e dependências; sem revogação global automática. |
| R6 | Storage isolamento/cleanup não comprovados em runtime | Bucket privado não prova autorização por workspace nem segurança de exclusão | ALTO | Staging com fixtures e cleanup dry-run; física desativada até aprovação. |
| R7 | Resultado ambíguo após refresh | Provedor pode invalidar token antigo antes da persistência | ALTO operacional | Estado conservador REAUTH_REQUIRED; UX/reconexão testadas em staging. |
| R8 | Falha de criptografia após resposta | Lease/versão pode exigir reautorização; indisponibilidade de conta | MÉDIO | Alertar e instrumentar sem logs de token; simular KMS. |
| R9 | Credencial service_role comprometida ignora limites de RPC | Service role é altamente privilegiada | CRÍTICO | Gestão de secrets, menor superfície e auditoria de acesso fora do escopo local. |
| R10 | `app_secret`/refresh em URL Shop | Pode ser capturado por logs de URL | ALTO potencial | Confirmar endpoint/método e sanitização de logs antes do staging. |
| R11 | Deno check não executado | Binário indisponível; sem instalação para evitar alteração global | MÉDIO | Rodar em ambiente CI/Deno aprovado. |
| R12 | Concorrência do provedor real não testada | Multiprocesso prova CAS local, não semântica externa | ALTO | Teste controlado em staging com app de teste e autorização específica. |

Severidades descrevem risco de rollout/arquitetura, não confirmam exploração. Cloud não foi consultado neste gate.
