# Privacy Policy Remediation

**Review date:** 2026-11-02
**Scope:** local bilingual source `apps/web/public/privacy-policy.html`; no live URL was accessed and no public file was changed.

## Findings

| Topic | Local source observation | Required decision/evidence | Status |
|---|---|---|---|
| Controller/operator | English and Portuguese copies contain `[OPERATOR NAME OR LEGAL ENTITY]`; operator identity is not to be inferred from another document | Owner confirms legal entity, jurisdiction and accurate contact/controller wording | BLOCKER |
| Date and website | `[DATE]` and `[WEBSITE URL]` placeholders remain; some links point to the Vercel project URL | Resolve date and canonical URL; verify all links in the actual deployed page separately | BLOCKER |
| Data categories | Source lists account, TikTok identity/credentials, user content, scheduling and technical data | Reconcile against current product and actual Shop fields, including raw JSON payloads | PARTIAL |
| Purposes/legal bases | Source names several possible legal bases and says policy is intended to comply with LGPD | Legal reviewer must map each purpose to a justified basis; do not imply a completed legal opinion | BLOCKER |
| Recipients/transfers | Source describes providers and international transfer safeguards in general terms | Confirm processors, locations, transfer mechanism and actual account configuration; align disclosure | BLOCKER |
| Retention | General retention wording without complete category-level periods | Approve schedule for media, jobs, tokens, audit/logs, Shop cache and backups; do not invent periods | BLOCKER |
| Deletion and rights | Describes email requests and verification; operational channel/SLA not evidenced | Confirm monitored mailbox, workflow, scope, deadlines and exceptions; test with synthetic staging data later | PARTIAL |
| TikTok integration | Source describes Login Kit scopes and publication modes; Shop is not proven to share the same token contract | Separate product flows, scopes and data categories; verify exact deployed features before notice | PARTIAL |
| Security and cookies | Source describes encryption, access controls and necessary cookies | Qualify local versus deployed controls; verify actual cookies, analytics, logs and provider settings | PARTIAL |
| Bilingual consistency | English and Portuguese versions appear in one HTML document | Conduct line-by-line legal/technical review so both languages describe the same behavior | PENDING |

## Placeholders and assertions to resolve

The inspected source contains `[DATE]`, `[WEBSITE URL]`, and `[OPERATOR NAME OR LEGAL ENTITY]` in both language sections. Search the whole document for any other bracketed text before publication. Confirm contact addresses privately; this report does not reproduce the address in source. Confirm the policy's legal statements, third-party transfer text, scope names, TikTok behavior, cookies and deletion promises against actual product behavior.

## Candidate handling

The existing public source must remain unchanged until owner/legal approval. If substantive changes are needed, prepare and review a separate `PRIVACY_POLICY_CANDIDATE.md`; compare its English and Portuguese text and run a placeholder/link audit before a separately authorized publication change. The candidate should:

1. Identify the verified legal operator and contact.
2. Describe actual data categories and purposes, including whether Shop orders are processed.
3. Distinguish TikTok Login Kit from TikTok Shop.
4. Identify recipients/processors and disclose transfer practices only after verification.
5. State approved retention periods or clearly explain the schedule once adopted.
6. Describe rights and a channel that is actually monitored.
7. Qualify safeguards accurately and avoid unsupported compliance guarantees.
8. Provide a version date and change history only after approval.

## Owner checklist before any publication

- [ ] Confirm controller/operator identity and public contact.
- [ ] Approve purpose/legal-basis mapping with qualified review.
- [ ] Reconcile data inventory with deployed fields and Shop scopes.
- [ ] Approve retention, deletion, backup and provider disclosures.
- [ ] Verify the request mailbox and response ownership.
- [ ] Review English/Portuguese parity.
- [ ] Resolve every placeholder and test every link.
- [ ] Approve a version and effective date.
- [ ] Publish only under a separate explicit deployment authorization; capture the real page afterward.

## Owner-provided business identity update (2026-11-02)

The owner supplied the CCMEI identity for drafting: AutoClip is the trade name of 56.151.919 DIOGO NASCIMENTO DOS SANTOS, MEI holder, CNPJ 56.151.919/0001-30, based in Rio de Janeiro/RJ, Brazil; privacy/security contact: diogos.nascimento@outlook.com. The public candidate now uses these known facts. Mailbox monitoring, legal bases, hosting regions, processors, retention periods, cookies, effective date and publication remain unverified. No CPF, full residential address, or CCMEI copy is included. The MEI/CNAE suitability for all SaaS activities is a separate accounting review, not resolved by this document.
