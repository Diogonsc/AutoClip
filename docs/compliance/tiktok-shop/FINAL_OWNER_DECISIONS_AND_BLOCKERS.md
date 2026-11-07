# Decisões Finais do Proprietário e Bloqueadores — TikTok Shop

**Estado:** preparação local para revisão humana; sem acesso a Partner Center ou sistemas remotos.
**Resultado:** questionário NO-GO para reenvio até resolver os itens P0 abaixo.

## Situação das políticas

| Documento | Versão/status | Finalidade e obrigação central | Implementação/evidência | Pendência/decisão |
|---|---|---|---|---|
| Information Security Policy | Draft 1.2; não aprovada | Regras de segurança, acesso, incidentes, desenvolvimento e revisão | Candidata local; inclui decisões expressas do proprietário; página pública conflitante | Resolver Q1 e aprovar versão; publicação só após autorização separada |
| Personal Information Protection Standard | 1.2-draft | Requisitos de tratamento, direitos, retenção, segurança e fornecedores | Evidência local parcial; vários controles Cloud/operacionais não verificados | Revisão humana, jurídica, operacional; decisão no record |
| Access Control Policy | Draft 1.1; não aprovada/publicada | Concessão, revisão e revogação de acesso | Código/RLS local não substitui política adotada nem configuração implantada | Aprovar/adotar, verificar controles e publicar se aplicável; resolver Q5 |
| Privacy Policy | Candidate 1.1-draft | Transparência de dados, finalidades, direitos e fornecedores | Fonte pública mantém placeholders; candidata conserva fatos desconhecidos | Completar dados técnicos, jurídicos, prazos, URL/data e revisão bilíngue |
| Terms of Service | Candidate 1.1-draft | Serviço, deveres, suspensão e relação contratual | Candidata; sem revisão jurídica | Completar URLs/data/escopo; revisão de direito do consumidor e cláusulas contratuais |
| Data Deletion Policy/page | Fonte HTML existente; publicação/operacionalização não verificadas | Informar solicitação e limites de exclusão | Fonte local contém e-mail; operação do canal e exclusão integral não testadas | Validar fluxo, escopo, prazos, backups/provedores; não alterar HTML neste gate |
| Incident Response Runbook | Procedimento escrito; adoção operacional não comprovada | Coordenar resposta e notificação | Runbook local; acompanhamento regular do e-mail foi confirmado pelo proprietário; suplência, registro e exercício ainda pendentes | Confirmar responsáveis/cobertura e executar exercício controlado em momento próprio |

## Fatos e estados

### Q1 — política de segurança publicada

- **HTML público local:** `apps/web/public/security-policy.html` declara versão 3.0, aprovação pelo titular em 30/10/2026, vigência e publicação. É uma afirmação contida na fonte local, não prova independente de aprovação ou disponibilidade pública.
- **PDF Q1:** `output/pdf/AutoClipe_Q1_Policy_v3_Approval_Pending.pdf` diz que a Policy v3.0 é rascunho, ainda não aprovada/publicada, e exige aprovação formal antes do envio.
- **PDF histórico:** Policy v1.0 possui campos de aprovação incompletos.
- **Candidata:** Security Policy Draft 1.2 está marcada DRAFT — PENDING OWNER APPROVAL e não substitui HTML/PDF históricos.
- **Comprovado:** o conflito documental existe nos artefatos locais. Não está comprovado qual alegação formal é verdadeira nem se a URL serviu o documento informado.
- **Correção após decisão:** verificar registro autêntico de aprovação e versão. Se houver aprovação válida, alinhar o documento candidato e planejar alteração/publicação somente sob autorização separada; se não houver, remover/corrigir a alegação pública em alteração futura aprovada e responder ao questionário de modo verdadeiro. Preservar os originais históricos.
- **Estado:** Q1 YES NOT SUPPORTED.

### Q5 — política de controle de acesso publicada

Distinguir cinco estados: (1) política escrita: existe apenas candidata local; (2) política aprovada: não; (3) política publicada: não há prova; (4) controle técnico implementado: há código/migrations/testes locais para partes de RLS/autorização; (5) controle operacional verificado: não demonstrado no ambiente implantado.

Para sustentar YES, confirmar o texto exato da pergunta e, se ela exige política publicada, obter aprovação formal, política acessível e captura/URL real após publicação autorizada; anexar documento que corresponda à pergunta; reconciliar conteúdo com a prática; comprovar controles que a pergunta especificamente pede. Até então Q5 YES NOT SUPPORTED.

## Placeholders e pendências por origem

### A. Dados fornecidos e preenchidos nos candidatos

Nome comercial AutoClipe; razão social 56.151.919 DIOGO NASCIMENTO DOS SANTOS; CNPJ 56.151.919/0001-30; município/UF Rio de Janeiro/RJ; país Brasil; contato diogos.nascimento@outlook.com. Nenhum CPF, endereço residencial completo ou cópia do CCMEI foi inserido.

### B. Confirmação do proprietário

Cobertura fora do acompanhamento regular do e-mail, suplente; aprovação e data efetiva; versão oficial Q1; pergunta e resposta exatas no formulário; histórico de incidentes/reclamações; DPO; quais fornecedores/serviços são usados; regiões reais; uso de cookies; escopo das solicitações de titulares; exatidão das respostas sobre exclusão; revisão do comentário ao avaliador.

### C. Verificação técnica

Publicação/URLs efetivamente acessíveis; regiões Supabase/Vercel/Storage/logs/backups; configuração de MFA para todos os administradores; grants/RLS implantados; operação e redaction de logs; fluxo real de exclusão; restauração (Gate 3.19.3 teve falha local); implantação M10/M11; cobertura de monitoramento. Não executar nenhuma verificação remota neste gate.

### D. Avaliação jurídica/contábil

Bases legais por finalidade; controlador/operador por fluxo; LGPD, direitos, retenção, transferências internacionais, suboperadores, notificações; Termos e direito do consumidor; validade de promessas de exclusão. Separadamente, contador deve avaliar se MEI/CNAE comporta as atividades SaaS pretendidas.

## Questionário — classificação preservada

| Item | Classificação atual | Bloqueio/condição |
|---|---|---|
| Q1 | YES NOT SUPPORTED | Conflito entre HTML e PDFs; aprovação/publicação não reconciliadas |
| Q4 | YES PARTIALLY SUPPORTED | Screenshots fornecidas para três contas; cobertura completa, aprovação e controles de endpoint pendentes |
| Q5 | YES NOT SUPPORTED | Política apenas candidata; sem aprovação/publicação/evidência |
| Q8 | YES PARTIALLY SUPPORTED | Registro e remediação pontual/cadência documentada; operação contínua não comprovada |
| Q2/Q3/Q6 | NO CONSISTENT | Manter enquanto os controles são não comprovados; não converter por existência de PDF |
| Q7 | OWNER CONFIRMATION REQUIRED | Texto exato e alegação pública precisam reconciliação |
| Incidentes/reclamações | OWNER CONFIRMATION REQUIRED | Respostas históricas NO não são demonstradas por busca de código |
| Política interna de dados pessoais | NO CONSISTENT | Só reconsiderar após aprovação e adoção do standard |
| Solicitações de dados / notificação / exclusão | Parcial | Operação do canal, prazos, abrangência e evidência precisam confirmação |
| Localização EUA | INSUFFICIENT INFORMATION | Região e fluxos não foram verificados |
| Certificações | NO / confirmar factualidade | Não há evidência de certificação AutoClip |

## Condições para novo envio

1. Resolver a versão/estado Q1 e registrar aprovação autêntica se existente.
2. Confirmar pergunta exata, resposta atual e anexos efetivamente solicitados.
3. Decidir Q5 de acordo com o texto e prova de aprovação/publicação que existir.
4. Revisar e aprovar políticas sem transformar controles locais em implantados.
5. Resolver placeholders legais e técnicos essenciais e revisar consistência bilíngue.
6. Confirmar localização, MFA, canal monitorado, retenção/exclusão e fatos históricos.
7. Preparar anexos com status fiel, redigir informação incidental de maneira irreversível e revisar a saída final.
8. Obter autorização humana específica para submissão.

## PDFs e anexos

O utilitário de marcação de artefato existe em `.../skills/pdf/container_tools/mark_artifact_operation_started.mjs`; a tentativa anterior falhou porque foi executada a partir da raiz do repositório, onde o caminho relativo não existe. Os PDFs de política candidatos podem ser gerados localmente com LibreOffice após executar o marcador na pasta da skill e passar por inspeção visual. Esta preparação não aprova nem publica os documentos. Para uma futura cópia Q4, manter o original restrito e intacto; renderizar todas as páginas para imagens, cobrir identificadores com máscaras opacas, rasterizar novamente o documento inteiro (sem anexar o PDF original), remover metadados, confirmar que `pdftotext` não recupera texto subjacente, verificar visualmente todas as páginas e procurar identificadores por inspeção/OCR antes de compartilhar. A cópia não deve alterar o status ou a evidência de MFA. Esse procedimento ainda não foi aplicado; a cópia Q4 permanece pendente.


## Atualização Draft 1.2 — decisões incorporadas

O proprietário confirmou que o titular do MEI coordena incidentes e que há acompanhamento regular do e-mail de segurança. Isso não equivale a monitoramento contínuo, SLA, delegado ou exercício concluído. Confirmou requisitos de elegibilidade para exclusão de mídia (publicação confirmada, pelo menos 24 horas, sem referência compartilhada impeditiva, sem operação pendente/desconhecida e com verificações seguras); não confirmou ativação/execução em produção. Confirmou Supabase, Vercel e TikTok como fornecedores conhecidos; regiões, subprocessadores, logs/backups e transferências continuam pendentes. OAuth exige controles de proteção/rotação/CAS/concorrência e tratamento conservador; Login Kit e Shop permanecem contratos distintos. Backup exige cobertura, RPO/RTO futuro, teste isolado, registro, correção e repetição; restauração anterior não foi comprovada.
