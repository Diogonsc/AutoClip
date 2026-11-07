# Document Inventory and Version Audit

**Review date:** 2026-11-02
**Scope:** local repository only. No publication URL, administrative account, Cloud project, or Partner Center was accessed.

This inventory records repository artifacts and their declared metadata. Filesystem modification times and PDF metadata are provenance clues, not proof of approval or publication.

## Inventory

| Document | Path / Git state | Declared version / date | Approval / responsible party | Public URL / publication evidence | Findings and action |
|---|---|---|---|---|---|
| Information Security & Privacy Policy | `apps/web/public/security-policy.html` — tracked; local source | v3.0; effective/approved 2026-10-30 | HTML states owner approval and names an owner/incident lead | HTML declares `https://autocliptiktok.vercel.app/security-policy.html`; this gate did not request the URL or verify its content | Conflicts with historical PDF v1.0 whose approval field is incomplete. Preserve source; reconcile with owner evidence before external reliance. |
| Historical Information Security and Privacy Policy | `artifacts/AutoClip_Information_Security_and_Privacy_Policy.pdf` — tracked | v1.0; footer says 2026-10-30 | Approval says it is to be completed; no completed signature/approval record found in the PDF | None established by this artifact | Preserve as history; do not treat as the effective version. |
| Historical editable policy | `artifacts/AutoClip_Information_Security_and_Privacy_Policy.docx` — tracked | Corresponding v1.0 artifact; document text not treated as an approval record | Approval is pending in corresponding PDF | Not established | Preserve; reconcile version lineage before archiving. |
| Rendered policy variants | `artifacts/rendered/`, `rendered_v2/`, `rendered_v3/`, `rendered_v4/` — tracked | All inspected first pages say v1.0 | Corresponding PDF approval remains incomplete | Not established | Root PDF and `rendered_v4` have identical SHA-256; other variants differ in bytes/layout. No variant supersedes v1.0 approval status. |
| Privacy Policy | `apps/web/public/privacy-policy.html` — tracked; bilingual source | `[DATE]` and operator/legal-entity placeholders | No completed approval record identified in source | Source links include the Vercel site; live accessibility not checked | Not publication-ready until placeholders, controller identity, data/transfer/legal language and contact are verified. |
| Terms of Service | `apps/web/public/terms-of-service.html` — tracked; bilingual source | `[DATE]`, `[WEBSITE URL]`, operator/legal-entity placeholders | No completed approval record identified in source | Source contains Vercel links; live accessibility not checked | Not publication-ready. Review service claims, legal entity, consumer terms, venue and cross-document consistency. |
| Data deletion instructions | `apps/web/public/data-deletion.html` — tracked | No clear approval/version metadata found | Describes an email request and identity verification; mailbox operation not evidenced | No live availability check | Page is a source artifact, not proof that the channel is monitored or requests are completed. |
| Personal Information Protection Standard | `docs/compliance/tiktok-shop/AUTOCLIP_PERSONAL_INFORMATION_PROTECTION_STANDARD.md` — pre-existing untracked draft, updated in this gate | 1.2-draft, prepared 2026-11-02 | MEI operator identified; owner approval/effective date pending | Not published | Adds owner-provided identity/contact and activity-specific controller/processor qualification; operational gaps remain. |
| Security control matrix and submission materials | `docs/compliance/tiktok-shop/SECURITY_CONTROL_EVIDENCE_MATRIX.md` and related files — pre-existing untracked | Review date 2026-11-02 | Draft/internal | Not published | Read and used as prior evidence; this gate adds a dated addendum to the matrix and links to remediation documents. |
| Incident Response Runbook | `docs/INCIDENT_RESPONSE_RUNBOOK.md` — tracked | No formal approval/version control shown | Names an owner role and a security contact in the source; this report deliberately does not repeat the contact | No public URL asserted | Process is documented. Monitoring, delegate coverage, register operation and tabletop evidence are not demonstrated. |
| Security Operations | `docs/SECURITY_OPERATIONS.md` — tracked | Operational evidence plan | Owner actions are requirements, not completed records | N/A | Contains explicit pending checks for provider settings, MFA, logs and incident operationalization. |
| Gates 3.18–3.19.3 | `docs/GATE_3_18_*`, `docs/GATE_3_19*` — local records, many untracked | Individual dates/statuses are stated in those reports | Historical technical reports | N/A | Use as historical, local or owner-reported evidence only; do not imply current Cloud deployment. |

## Business identity regularization — 2026-11-02

The owner supplied CCMEI-derived identity for candidate drafting: AutoClipe is the trade name of 56.151.919 DIOGO NASCIMENTO DOS SANTOS, MEI holder, CNPJ 56.151.919/0001-30, based in Rio de Janeiro/RJ, Brazil; contact: diogos.nascimento@outlook.com. The CCMEI itself, CPF and full residential address are not included. The legal operator is the accountable business operator; controller/processor status remains activity-specific. MEI/CNAE suitability for intended SaaS activities is a separate accounting review. Candidate documents have been updated, but no policy approval, publication, contact monitoring, data residency or operational configuration was established.

## Version comparison evidence

The public-source HTML declares v3.0 approval and publication. The root PDF and rendered variants declare v1.0, and the root PDF expressly leaves approval to be completed. Root PDF SHA-256: `53555620c8f40b174912a99f5dacb9128d75dd8cf83d42f96a25726c406bff19`. HTML SHA-256 at inventory: `e829ee05bf37d18bc079d2f177662fcb4604aafafd1ccea043faa933d3ece788`. These hashes identify the inspected local bytes; they do not prove publication, author identity, or approval.

The source directories also contain four rendered PDFs. Their declared text remains v1.0; layout/byte differences do not establish distinct approvals. Root PDF and `rendered_v4` are byte-identical. No historical version was edited in this gate.

### Security policy section comparison

| Section | HTML v3.0 source | PDF v1.0 source | Evidence/consistency | Proposed decision |
|---|---|---|---|---|
| Purpose/scope | Security/privacy controls for a multi-tenant service and integrations | Scope/principles and intended audience | Broadly aligned; both are policy text, not proof of deployment | Use the candidate's scoped description; owner confirms service scope |
| Governance/approval | Names an owner/incident lead, approver and date; claims electronic approval | Names generic operator and approval still to be completed | Direct approval-record conflict; no independent approval evidence supplied | Reconcile against authentic owner decision; do not infer which is authoritative |
| Access/RLS | Roles, RLS, restricted Shop-token table, safe listing and publication association claims, with production-test caveat | Workspace roles, RLS, authorization helpers and constraints stated generally | HTML adds specific migration claims; deployed status remains a separate evidence question | Retain only source-supported claims and state local versus remote limits |
| OAuth/token security | AES-256-GCM, one-time state, Shop persistence checks, secret-store and URL-log requirements | AES-256-GCM, connection AAD, server secret and token handling | Generally consistent on local crypto design; HTML adds operational requirements | Qualify as local code evidence; deployment/configuration and product-specific contracts remain unverified |
| Media/publication | Detailed workspace association, worker secret, duplicate-publication marker, reconciliation and signed media delivery | General HTTPS/media delivery and RLS | HTML contains newer implementation-specific claims; no runtime proof here | Reference implementation only when supported by local migration/code; preserve operational caveat |
| Privacy/minimization | Purpose limitation, Shop data minimization, no unrelated sale/use, subprocessor disclosure | Broad data categories and purpose statements | Both require actual data map and legal review; raw Shop JSON is a material gap | Use conservative candidate wording and resolve payload inventory before Shop processing claims |
| Logging/monitoring | UTC/event fields, log access, monitoring categories, vulnerability tracking | Audit-log structures and no-secret logging requirement | Local requirements and source structures do not prove deployed logging/monitoring | Keep as requirements; do not claim monitoring operational without evidence |
| Incident response | Runbook, Q16 label, detailed steps, and explicit operational adoption preconditions | Incident process and stages; operator must assign lead/contact | Both say operational readiness requires adoption; HTML is more explicit. Exact Partner Center Q16 is unconfirmed | Keep readiness caveat; do not map the HTML label to the rejected form question without screenshot |
| Continuity/backups | Recovery procedure required; explicitly says verify backups/recovery | No comparable dedicated section; general lawful retention/backup-cycle text | Gate 3.19.3 restore rehearsal failed | Candidate says recovery is not verified; no backup-success claim |
| Evidence references | Lists local migration/function references and reported remote status qualified as not independently verified | No evidence register | HTML is more traceable, but some migration identifiers remain historical/local | Preserve source references only after checking exact local file; label remote status as reported, not confirmed |
| Contact/approval/publication | Specific contact and legal entity; declares approval and public URL | Contact field plus blank approval record | Contact data is present in source; publication claim not independently verified and approval conflicts | Do not reproduce contact in this report; owner verifies channel and record privately |

The table compares document claims, not the completeness of controls. The candidate policy file is the reviewable consolidation; neither source is silently selected as authoritative.

## Worktree preservation

At start, branch was `main`; the worktree contained extensive tracked modifications and untracked files, including the prior TikTok Shop compliance drafts. This gate did not stage, reset, clean, or overwrite them. Only new regularization documents and the dated addendum to the existing untracked evidence matrix are intended changes for this gate. Review `git status --short` before any later staging or publication.

## Owner decisions needed

1. Identify the authoritative security-policy version and provide its approval record, if one exists.
2. Decide whether the v3.0 approval/publication statement is accurate; if not, correct it only in a separately approved publication change.
3. Confirm legal entity/controller, public contact channel, dates, service/data facts, and retention language for Privacy Policy and Terms.
4. Confirm whether the declared public URLs currently serve the reviewed content, using a separately authorized public-site check.
5. Keep all drafts labeled as drafts until these decisions are recorded.


## Gate de aprovação documental — 2026-11-02

Foi criado `OWNER_POLICY_DECISION_PACK.md` e atualizado `OWNER_POLICY_APPROVAL_RECORD.md`; nenhum campo decisório foi preenchido. Cinco PDFs derivados das candidatas foram gerados em `output/pdf/DRAFT_AutoClipe_*.pdf`, com banner DRAFT. Não alteram nem substituem HTML/PDF históricos. A cópia sanitizada Q4 não foi gerada; o original permanece intocado e restrito.


## Information Security Policy Draft 1.2 — 2026-11-02

A candidata `AUTOCLIP_SECURITY_POLICY_CANDIDATE.md` foi consolidada como Draft 1.2 e permanece `DRAFT — PENDING OWNER APPROVAL`. O PDF atual é `output/pdf/DRAFT_AutoClip_Information_Security_Policy_Draft_1.2.pdf`; `DRAFT_AutoClip_Information_Security_Policy.pdf` é a cópia do Draft 1.1 anterior e foi preservada. As fontes públicas e os PDFs históricos permaneceram inalterados.
