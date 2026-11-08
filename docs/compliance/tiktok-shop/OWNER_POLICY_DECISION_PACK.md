# Pacote de Decisão do Proprietário — Políticas AutoClip

**Status:** material para revisão humana; nenhuma decisão foi registrada.
**Operador informado:** 56.151.919 DIOGO NASCIMENTO DOS SANTOS, titular do MEI; CNPJ 56.151.919/0001-30; nome comercial AutoClip; Rio de Janeiro/RJ, Brasil.
**Contato indicado:** diogos.nascimento@outlook.com. O proprietário confirmou acompanhamento regular para o contato de segurança; isso não é monitoramento 24/7, SLA, suplência nem verificação independente.

Este pacote resume obrigações propostas nos rascunhos. Seis PDFs candidatos existem para revisão, incluindo a Security Policy Draft 1.2 atual e o PDF Draft 1.1 anterior preservado; os caminhos estão em `OWNER_POLICY_APPROVAL_RECORD.md`. Todos permanecem rascunhos. A cópia sanitizada Q4 ainda não foi gerada. A aprovação significa adoção organizacional do conteúdo, não prova automática de implantação técnica, publicação, conformidade legal, certificação ou aprovação TikTok. Para cada documento, selecione uma opção, justifique e date. Não preencha por inferência.

## 1. Information Security Policy — candidata Draft 1.2

**Finalidade:** estabelecer regras de segurança para aplicação, dados, contas administrativas, integrações e operação.

PDF de revisão: `output/pdf/DRAFT_AutoClip_Information_Security_Policy_Draft_1.2.pdf`.

**Ao aprovar, o proprietário assume:** designar responsáveis; exigir acesso mínimo, proteção de credenciais, análise de mudanças, resposta a incidentes, gestão de vulnerabilidades e revisão periódica; manter políticas coerentes com a prática.

**Decisões confirmadas nesta revisão:** o titular do MEI coordena incidentes; o proprietário informa acompanhamento regular do e-mail de segurança, sem declarar disponibilidade 24/7, SLA, suplente ou exercício. Mídia só poderá ser elegível para exclusão automática após publicação confirmada, janela mínima de 24 horas, ausência de referências compartilhadas impeditivas ou operações pendentes/desconhecidas e aprovação das verificações de exclusão segura. Tokens OAuth devem ser protegidos, rotacionados com coordenação concorrente e persistência condicional; Login Kit e Shop são tratados separadamente. Fornecedores conhecidos: Supabase, Vercel e TikTok. A recuperação deve ser testada em ambiente isolado; o teste anterior não comprovou restauração.

**Verificar antes da aprovação:** conflito entre o HTML público v3.0 (declara aprovação e publicação em 30/10/2026) e o PDF Q1 (diz que v3.0 ainda aguarda aprovação/publicação), além do PDF histórico v1.0 sem aprovação completa. Não há neste pacote registro independente que resolva o conflito.

**Risco:** aprovar o candidato sem corrigir a fonte pública pode manter uma alegação material contraditória. A candidata não substitui a página pública nem o histórico.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 2. Personal Information Protection Standard — v1.2-draft

**Finalidade:** definir requisitos para dados pessoais, controles, retenção, direitos, incidentes e fornecedores.

**Ao aprovar, o proprietário assume:** manter inventário e finalidade; determinar papéis por fluxo; limitar acesso; proteger tokens; aprovar retenção; tratar solicitações verificadas; revisar fornecedores e transferências; manter processos de incidente e recuperação.

**Verificar antes da aprovação:** canal de privacidade monitorado; responsáveis e suplentes; bases legais e deveres LGPD com assessoria qualificada; prazos e exceções de retenção; regiões e suboperadores; OAuth específico do TikTok Shop; restauração/backup (Gate 3.19.3 registrou falha de restauração local); M10/M11 e controles ainda não comprovados em produção. O status não equivale a conformidade integral.

**Risco:** adoção de obrigações sem capacidade operacional documentada.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 3. Access Control Policy — Draft 1.1

**Finalidade:** governar concessão, revisão, uso e revogação de acesso administrativo e por workspace.

**Ao aprovar, o proprietário assume:** identificar usuários; limitar privilégios; rever acessos; remover acessos encerrados; controlar emergência; registrar alterações; proteger segredos; exigir autorização consistente em banco, RPCs, funções e Storage.

**Verificar antes da aprovação:** lista atual de administradores; MFA e recuperação para todas as contas privilegiadas; frequência executável de revisão; evidência de operação do processo; RLS/grants implantados e testes cross-tenant em ambiente aprovado. Código local não comprova política publicada nem configuração Cloud.

**Risco:** declarar política aprovada/publicada sem processo de revisão ou prova de aplicação.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 4. Privacy Policy — Candidate 1.1-draft

**Finalidade:** informar pessoas sobre dados, propósitos, compartilhamento, direitos, retenção e salvaguardas.

**Ao aprovar, o proprietário assume:** transparência verdadeira sobre fluxos, atendimento de direitos e publicação de conteúdo consistente com os serviços realmente ativos.

**Exige revisão jurídica/factual:** base legal por finalidade; papéis de controlador/operador por atividade; dados e payloads Shop; lista de fornecedores; regiões/transferências; cookies; prazos de retenção; processo e prazo de direitos; URL pública, versão e data efetiva. Não presumir que o contato é monitorado.

**Risco:** a política pública atual contém placeholders e não foi verificada remotamente.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 5. Terms of Service — Candidate 1.1-draft

**Finalidade:** definir serviço, responsabilidades, uso aceitável, dependências de plataforma, suspensão e encerramento.

**Ao aprovar, o proprietário assume:** obrigações contratuais sobre acesso, conteúdo, segurança, suporte, mudanças e encerramento.

**Exige aconselhamento jurídico:** elegibilidade; licença de conteúdo; disponibilidade; garantias e responsabilidade; consumidor; foro/lei; consentimento/aceite eletrônico; efeitos de encerramento, dados, jobs e tokens. Resolver URL e data; checkout/cobrança segue fora do escopo desta fase.

**Risco:** termos que prometam exclusão imediata, publicação garantida ou mecanismos de disputa inadequados.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 6. Data Deletion Policy/page — fonte existente; status operacional não verificado

**Finalidade:** explicar como solicitar exclusão e limites relativos a workspaces, retenções e conteúdo já publicado.

**Ao adotar/publicar:** assumir o processo descrito, inclusive verificação de identidade e encaminhamento do pedido.

**Verificar:** canal efetivamente monitorado; escopo por Auth, banco, Storage, logs, backups e provedores; prazos; retenções legais; memberships e referências compartilhadas; comportamento de desconexão TikTok; URL e conteúdo público.

**Risco:** prometer exclusão total ou imediata onde há backups, retenções legais ou dados mantidos por terceiros. A página pública não foi alterada.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## 7. Incident Response Runbook — procedimento existente; adoção parcial

**Finalidade:** organizar detecção, contenção, investigação, notificação e recuperação.

**Ao adotar:** assumir a atribuição de incident lead e as tarefas do runbook; manter contato de segurança, registro, suplência e escalonamento.

**Confirmado pelo proprietário:** titular do MEI coordena incidentes e há acompanhamento regular do e-mail indicado.

**Verificar:** frequência/escopo prático e cobertura fora desse acompanhamento; suplente; registro protegido; critérios/prazos de notificação revisados juridicamente; exercício de mesa. Não declarar 24/7, SLA, delegado ou exercício concluído. A confirmação do proprietário não é uma auditoria independente.

**Risco:** resposta tardia se o endereço não for monitorado ou não houver cobertura quando o titular estiver indisponível.

**Decisão:** [ ] APROVAR  [ ] SOLICITAR CORREÇÕES  [ ] NÃO APROVAR
**Justificativa/condições:** __________________________________________________
**Data:** __________________

## Decisões transversais

- [ ] Confirmar que os dados do MEI acima estão corretos para uso documental.
- [ ] Determinar, com revisão apropriada, o papel do operador por fluxo de dados; não atribuir papel universal.
- [x] Proprietário confirmou acompanhamento regular do e-mail de segurança.
- [ ] Definir cobertura na ausência do titular e não prometer 24/7 ou SLA sem controles adicionais.
- [ ] Resolver a divergência Q1 entre HTML e anexos antes de qualquer resposta afirmativa.
- [ ] Confirmar o texto exato da Q5; YES exige política aprovada, publicada e evidência correspondente, se esse for o requisito.
- [ ] Confirmar fatos históricos de incidentes/reclamações e dados de localização.
- [ ] Solicitar assessoria jurídica sobre LGPD, consumidores, bases legais, transferências, retenção, termos e notificações.
- [ ] Solicitar revisão contábil separada sobre a adequação do MEI/CNAE às atividades SaaS pretendidas.
- [ ] Autorizar publicação e submissão em decisão separada; nenhuma ação é autorizada por este documento.
