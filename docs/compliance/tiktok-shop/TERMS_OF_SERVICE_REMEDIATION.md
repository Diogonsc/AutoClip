# Terms of Service Remediation

**Review date:** 2026-11-02
**Source:** `apps/web/public/terms-of-service.html` (English and Portuguese); no public URL was checked and the source was not modified.

## Findings

| Topic | Source observation | Required action | Status |
|---|---|---|---|
| Operator identity | `[OPERATOR NAME OR LEGAL ENTITY]` appears in both language sections | Confirm legal entity, jurisdiction and notices contact; legal review | BLOCKER |
| Date and website | `[DATE]` and `[WEBSITE URL]` remain, including navigation links | Confirm canonical site and effective date; verify deployment separately | BLOCKER |
| Service description | Describes TikTok Login Kit/Content Posting API and direct/draft flows | Compare wording to currently enabled features and approved app/API scopes; do not imply TikTok Shop functionality absent from actual implementation | PARTIAL |
| Account and user duties | Includes credential, account and content responsibilities | Review proportionality, consumer law and support/recovery commitments | PENDING LEGAL REVIEW |
| Third-party platform | States TikTok controls platform/API decisions | Keep only accurate platform boundaries; distinguish TikTok Shop and separate authorization | PARTIAL |
| Content license | Grants a limited service-delivery license with retention caveat | Confirm necessity, duration, deletion effects and consistency with privacy notice | PENDING LEGAL REVIEW |
| Suspension/termination | Allows suspension/termination for security or breach | Align triggers, notice, appeals and effects on scheduled jobs/tokens | PENDING LEGAL REVIEW |
| Liability and disputes | Contains limitation of liability and venue language | Legal review for Brazilian consumer rules and mandatory rights; no independent legal conclusion here | BLOCKER |
| Privacy/deletion cross-references | Links to local policy URLs and describes deletion | Confirm both target pages exist publicly and contain matching terms | NOT VERIFIED |
| Portuguese parity | Bilingual copy appears in one file | Perform legal/technical parity review | PENDING |

## Candidate drafting decision

Because identity, effective date and legal terms are unresolved, the existing public Terms should not be silently edited. A separate `TERMS_OF_SERVICE_CANDIDATE.md` has been prepared with explicit placeholders and conservative service boundaries. It is a review draft, not an offer or approved contract. No checkout, subscription billing or payment terms are added because billing remains outside the deployment scope.

## Required review before approval

- Confirm operator and consumer-facing contact.
- Confirm service features, supported account flows, and no unsupported platform guarantee.
- Reconcile user-content license, retention and deletion clauses with actual system behavior.
- Review suspension/termination and queued publication effects.
- Obtain qualified review of liability, venue, consumer rights, governing law and electronic acceptance.
- Check Portuguese/English parity and every internal URL.
- Approve a version, date and change history; publish only under separate authorization.

## Owner-provided business identity update (2026-11-02)

The candidate now identifies AutoClipe as a trade name operated by 56.151.919 DIOGO NASCIMENTO DOS SANTOS, MEI holder, CNPJ 56.151.919/0001-30, based in Rio de Janeiro/RJ, Brazil, with contact diogos.nascimento@outlook.com. No public source or effective date was changed. Consumer-law review, website URL, operational contact coverage, product scope and contractual terms remain pending. MEI/CNAE suitability for all SaaS activities requires separate accounting review.
