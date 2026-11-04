# TikTok Shop Questionnaire — Final Attachment Mapping

**Status:** local preparation only. No files were uploaded. “PDF available” means a local artifact exists, not that it is approved or acceptable to submit.

| Question/topic | Current answer | Recommended evidence | Local source / PDF | Approval and additional proof | Status / owner action |
|---|---|---|---|---|---|
| Q1 Security policy published | YES | One reconciled, approved security policy/PIP standard plus verified URL capture and approval record | Q1 PDF exists but explicitly says approval/publication pending; HTML v3.0 conflicts with historical v1.0 PDF | Formal owner approval, legal entity/date, current public access and exact Partner Center question | **NO-GO** — do not attach Q1 pending PDF as proof or retain YES without reconciliation |
| Q2 Network segregation | NO | If requested, Q2 report explaining application controls versus infrastructure segmentation, plus project-specific provider settings evidence | `output/pdf/AutoClip_Q2_Revised_Evidence.pdf` available; status partial | Verify production/network/project controls; owner approval of evidence | **NO answer consistent** — report may explain limitation; no YES claim |
| Q3 Endpoint protection | NO | Q3 report and fresh sanitized workstation/endpoint evidence only after controls are actually configured | `output/pdf/AutoClip_Q3_Revised_Evidence.pdf` available; status open | Active EDR/antimalware decision, patch/firewall/unlock evidence, owner review | **NO answer consistent** — do not claim active protection |
| Q4 Baseline/password/MFA | YES | Revised Q4 report, selected authentic exhibits A–C and carefully scoped workstation evidence | `output/pdf/AutoClip_Q4_Revised_Evidence.pdf` available; screenshots were visually reviewed in this local gate | Owner confirms privileged-account coverage, workstation unlock test, password rationale and formal approval; redact incidental identifiers in a derivative while preserving original privately | **PARTIAL** — attach only after sanitization and owner approval; YES depends on exact question scope |
| Q5 Published access-control policy | YES | Approved and accessible access-control policy plus technical evidence for the specific claim | No Q5 PDF found; `AUTOCLIP_ACCESS_CONTROL_POLICY_CANDIDATE.md` is draft only | Owner approval, effective date, publication proof and deployed evidence as applicable | **NO-GO** — current candidate cannot substantiate published-policy YES |
| Q6 Classification/encryption | NO | Q6 report to explain token encryption evidence and limits; provider evidence if the form asks about data-at-rest encryption | `output/pdf/AutoClip_Q6_Revised_Evidence.pdf` available; partial | Verify key provisioning, TLS, database/Storage/backup encryption and any classification policy | **NO answer consistent** — local token crypto alone is insufficient for YES |
| Q7 Published incident response policy | NO | Q7 report/runbook; if YES is reconsidered, provide approved/published policy and operational proof | `output/pdf/AutoClip_Q7_Revised_Evidence.pdf` available; says documented, not demonstrated operational | Resolve HTML publication claim, approve runbook, prove channel/register/delegate/tabletop | **OWNER CONFIRMATION REQUIRED** — exact question and publication state matter |
| Q8 Vulnerability management | YES | Q8 report plus register and dated audit/remediation records | `output/pdf/AutoClip_Q8_Revised_Evidence.pdf` available; `docs/VULNERABILITY_REGISTER.md` exists | Owner confirms ongoing cadence, current scan and deployed version; review report approval | **PARTIAL** — one closed item and policy cadence do not prove continuity |
| Privacy incidents/complaints (last 3 years) | NO / NO | None unless records exist; owner factual confirmation and controlled incident/complaint register review | No actual event records supplied | Owner confirms after checking business, support, legal and provider records | **PENDING OWNER ATTESTATION** |
| Data location | United States | Sanitized region/deployment evidence for each applicable provider and backup/log path | `DATA_LOCATION_VERIFICATION.md`; no region evidence in local repository | Owner checks Supabase, Vercel, Storage, logs/backups and TikTok/Shop processing terms | **NO-GO TO ASSERT** until verified |
| Internal PIP policy | NO | Owner-approved/effective standard and adoption evidence | PIP Standard v1.1-draft; no PDF generated | Complete approval record and adoption | **NO currently consistent**; re-evaluate only after adoption |
| User data requests | YES | Published request instructions plus evidence of monitored workflow for access/correction/export/deletion | Deletion page source and local account deletion code; no dedicated PDF | Owner confirms channel/SLA and synthetic end-to-end workflow; Shop seller/user request path | **PARTIAL** |
| Updated Privacy Policy | YES | Completed bilingual privacy notice and real public URL capture | Existing HTML has placeholders; candidate Markdown exists | Resolve identity/date/website/legal/transfer/retention wording, approve and verify live URL | **NO-GO** |
| Formal DPO | NO | No attachment unless a formal designation exists | None found in reviewed local docs | Owner confirms actual appointment state | **PENDING CONFIRMATION** |
| Breach notification process | YES | Approved procedure plus operational evidence for contact, register and exercise | Runbook and Q7 PDF; local only | Confirm responsibilities, legal notification assessment and tabletop | **PARTIAL** |
| Deletion at contract end | YES | Approved retention/deletion schedule and tested end-of-relationship workflow | Data deletion page source and local code; restore/backup limits documented | Define categories, legal exceptions, backup expiry, provider data and TikTok-published content | **PARTIAL / DO NOT PROMISE ABSOLUTE DELETION** |
| ISO/SOC certifications | NO | No certification attachment | No AutoClip certification evidence found | Owner confirms none is held | **NO consistent** |

## Package handling

- Do not attach historical v1.0 PDF or the Q1 “Approval Pending” PDF as proof of an approved policy.
- Keep original Q4 screenshot PDF access-controlled; it contains incidental account identifiers. Create a transparently redacted copy only for submission after owner review; never alter status or fabricate UI.
- Q2/Q3/Q6/Q7/Q8 reports are evidence explanations with pending approvals/operational checks. They do not turn a NO into a YES.
- No PDF was generated from a Markdown draft in this gate. The Markdown standard remains clearly labeled draft, and there is no approved content to render as an effective policy.

## Identity regularization update — 2026-11-02

Candidate documents now use the owner-supplied MEI identity and contact. The PIP Standard (v1.2-draft), Security Policy (candidate), Access Control Policy (candidate), Privacy Policy (candidate) and Terms (candidate) now identify the owner-provided MEI operator/contact where relevant, but remain drafts. Their PDFs, if generated, must visibly retain DRAFT — PENDING OWNER APPROVAL. Q1 and Q5 remain NO-GO; Q4 and Q8 remain partial. No policy is approved or published by this update.


## PDFs candidatos deste gate

| Documento | PDF gerado | Estado | Próxima ação |
|---|---|---|---|
| Information Security Policy | `output/pdf/DRAFT_AutoClip_Information_Security_Policy_Draft_1.2.pdf` | Draft 1.2 — DRAFT — PENDING OWNER APPROVAL | Revisar decisão Q1, não enviar antes de reconciliar HTML e histórico |
| Personal Information Protection Standard v1.2 | `output/pdf/DRAFT_AutoClip_Personal_Information_Protection_Standard_v1.2.pdf` | DRAFT — PENDING OWNER APPROVAL | Revisão humana, jurídica e operacional |
| Access Control Policy | `output/pdf/DRAFT_AutoClip_Access_Control_Policy.pdf` | DRAFT — PENDING OWNER APPROVAL | Revisar, aprovar e publicar se necessário para sustentar Q5 |
| Privacy Policy | `output/pdf/DRAFT_AutoClip_Privacy_Policy.pdf` | DRAFT — PENDING OWNER/LEGAL REVIEW; placeholders | Não enviar como política final |
| Terms of Service | `output/pdf/DRAFT_AutoClip_Terms_of_Service.pdf` | DRAFT — PENDING OWNER/LEGAL REVIEW; placeholders | Não enviar como termos vigentes |
| Q4 evidence | Original `output/pdf/AutoClip_Q4_Revised_Evidence.pdf` preservado | Contém identificadores incidentais; não sanitizado | Preparar cópia irreversivelmente rasterizada/redigida e revisar antes de eventual envio |

PDFs candidate foram gerados via LibreOffice a partir dos Markdown locais, com banner de rascunho. Não são páginas públicas nem documentos efetivos.


## Procedimento para anexos definitivos após aprovação

1. O proprietário registra no `OWNER_POLICY_APPROVAL_RECORD.md` o documento/versão exata, decisão, aprovador, data de revisão e data efetiva; não inserir assinatura privada no repositório.
2. Resolver apenas placeholders confirmados e fazer nova revisão legal/técnica; aumentar versão e histórico, preservando candidatos e PDFs anteriores.
3. Gerar o PDF somente da versão aprovada. Usar o utilitário da skill PDF a partir de sua pasta: `node container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format pdf` (ajustar quantidade real), converter a fonte aprovada e salvar com nome/versão explícitos sem sobrescrever arquivos históricos.
4. Conferir texto extraído, metadados, status, paginação e renderização visual de todas as páginas; confirmar que não existem placeholders, identificadores incidentais ou afirmações não sustentadas.
5. Calcular SHA-256 da fonte e do PDF final, registrar a relação entre versões e manter cópia controlada.
6. Publicação e submissão exigem autorizações separadas; depois de publicar, capturar a página real e confirmar a URL antes de marcar qualquer resposta como sustentada.

Este procedimento não aprova documentos nem autoriza publicação/submissão.
