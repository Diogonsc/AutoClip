# Administrative MFA Evidence Checklist

**Status:** no administrative account settings were accessed directly. The owner-provided `output/pdf/AutoClipe_Q4_Revised_Evidence.pdf` was found and its screenshot pages were visually reviewed locally. It reports account-level MFA/2FA for GitHub, Supabase and Vercel. This is user-provided evidence, not an independent account audit, and does not prove coverage of all privileged users.

| Service/account class | Evidence it is used | Verification owner | MFA status | Real evidence required | Redact | Current status |
|---|---|---|---|---|---|---|
| Supabase project administration | Supabase Cloud is the backend in project documentation | Project owner / authorized Supabase administrator | User-provided Q4 screenshot reports TOTP authenticator added on 2026-10-30; not independently verified | Confirm screenshot is current, cover all privileged accounts, review access roster and recovery methods | Email/phone where unnecessary, recovery codes, API keys, project secrets, JWTs | PARTIAL — owner confirmation and coverage review pending |
| Vercel hosting administration | Frontend hosting is documented as Vercel | Project owner / authorized Vercel administrator | User-provided Q4 screenshot reports 2FA active/TOTP enrolled; not independently verified | Confirm screenshot is current and covers every privileged team member | Personal email, team IDs if unnecessary, tokens, env values | PARTIAL — owner confirmation and coverage review pending |
| TikTok for Developers app administration | TikTok OAuth/API integration exists locally | App owner | NOT VERIFIED | Account MFA/security settings and app-member access list, if available | App secrets, OAuth codes/tokens, private identifiers | PENDING |
| TikTok Shop Partner Center | TikTok Shop review process exists | Partner Center owner | NOT VERIFIED | Account MFA/security settings and least-privilege member list, if available | Seller/shop IDs, buyer/order data, recovery data, app secrets | PENDING |
| Source control | Repository is Git-managed; Q4 evidence identifies a GitHub account, but the repository's configured hosting relationship was not independently checked | Project owner | User-provided Q4 screenshot reports GitHub authenticator MFA and two passkeys; not independently verified | Confirm account/repository mapping, screenshot currency, privileged collaborator coverage and recovery controls | Personal email, tokens, private repository URLs if sensitive | PARTIAL — owner confirmation and coverage review pending |
| Administrative email/security contact | Existing local policy/runbook names a contact channel; provider and monitoring are not verified here | Project owner | NOT VERIFIED | Confirm provider/account owner, MFA, forwarding rules and monitoring coverage | Personal address, message contents, recovery codes | PENDING |
| Domain/DNS registrar | No provider established by reviewed repository evidence | Project owner, if a registrar account is used | NOT APPLICABLE UNTIL IDENTIFIED | Identify authoritative domain registrar/DNS accounts, then verify MFA and access | Customer data, account recovery information, tokens | NOT VERIFIED |

## Safe capture procedure

1. The owner signs in directly through the known official service URL. Do not share credentials with an auditor or in chat.
2. Open account security/MFA status and a minimally scoped member/access view.
3. Capture an authentic screenshot or provider export with date and service identified. Do not alter the status or recreate the UI.
4. Redact recovery codes, QR enrollment seeds, tokens, secrets and unrelated personal data. Preserve the original in restricted evidence storage and record the redacted-copy relationship.
5. Record reviewer, verification date, account class and findings without recording secrets.
6. If MFA is unavailable or not enabled, record it truthfully and apply an owner-approved compensating plan; do not label it enabled.

No screenshot is included or fabricated by this gate.

## Q4 PDF limitations

The Q4 evidence report itself is marked “Prepared for formal approval” and states that screenshots cover three accounts only, not every privileged administrator. Its workstation exhibit is a transcription of supplied command results; password-on-unlock was not separately confirmed, password expiration is “never,” and policy rationale remains pending. The exhibit screenshots contain incidental account identifiers; keep the original restricted and make a visibly identified redacted derivative only if authorized for submission. Do not alter the displayed MFA status.
