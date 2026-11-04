# Pre-publication Security Review — Information Security Policy v1.2

**Assessment date:** 2026-11-02  
**Scope:** Local repository and local build only. No Vercel, Supabase Cloud, TikTok Partner Center, or other remote service was accessed. No deployment was run.

## Executive decision

**NO-GO to publish from the current worktree or current local build.** The policy content is internally consistent and suitable for human review, but the configured Vite build produces the full web application, not a document-only artifact. The worktree contains substantial unrelated, uncommitted frontend changes, and the active Vercel project/root/deployment baseline could not be verified locally.

A future isolated deployment may be considered after the production baseline and Vercel project settings are confirmed and a clean, single-file change is reviewed. This report does not authorize that work or a deployment.

## 1. Repository and deployment scope

- Branch: `main`.
- `HEAD` and `origin/main`: both `0c3a6694b24463e5522fca959e7fb335a9e18225`.
- Worktree before creating this report: 40 tracked modified files and 210 untracked files; within `apps/web`, 18 tracked modified files and 13 untracked files.
- The policy page is one tracked modification: `apps/web/public/security-policy.html`.
- No `.vercel/project.json`, `.vercelignore`, or Vercel CLI was found locally. The actual Vercel project linkage, configured Root Directory, production branch, environment assignments, and current deployed commit are therefore **NOT VERIFIED**.

Local project configuration in `apps/web/vercel.json` declares Vite, `npm run build`, output directory `dist`, a media rewrite to a Supabase Edge Function, and a catch-all rewrite to `/index.html`. `apps/web/package.json` confirms the build is `tsc --noEmit && vite build`. `apps/web/vite.config.ts` sets `envDir` to the repository root.

If the Vercel Root Directory is `apps/web` and this configuration is applied, an eventual deployment is a complete immutable site deployment from `apps/web/dist`, not a single-file update. The current local build contains 56 files: the SPA entry point, generated JavaScript/CSS/font bundles, and all public assets (including the privacy, terms, data-deletion, and security pages, icons, manifest, and verification file). Its JavaScript bundles were built from the current dirty source tree, including unrelated feature changes. A Git-connected deploy would normally use a commit rather than these uncommitted files, but the actual project deployment path/settings have not been checked.

### Build environment risk

The current Vite configuration loads repository-root `.env.local`. That file exists locally and defines public-prefixed Supabase URL/key variables as well as non-public credentials. The app source references `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; these are public client configuration, not service-role credentials. A scan found no non-`VITE_` credential values embedded in the current `dist` output. The local public URL/key values are environment-specific, however, and must not be assumed appropriate for a production build. No values are reproduced in this report.

The local build is not evidence of the artifact Vercel would produce: remote environment variables, build settings, project root, and production baseline were not available for verification.

## 2. Policy integrity

The following local sources agree on version, approval date, business identity, security contact, and documented limitations:

- `docs/compliance/tiktok-shop/AUTOCLIP_SECURITY_POLICY_v1.2.md` — SHA-256 `a7dd38ebed4d39907fe75a1991ed4d29955d673f20341122ede6c6196c68eaf0`.
- `output/pdf/AutoClip_Information_Security_Policy_v1.2_APPROVED.pdf` — SHA-256 `250dc7e766286b439f2b2ce33011e3148fcd3645731f3ee900a4e3ec87ff29d6`.
- `apps/web/public/security-policy.html` — SHA-256 `fb5a039a0b9234bf81329bbad714595af2acbdbaaaacbb55ce4aa5c233a4609b`.
- `docs/compliance/tiktok-shop/OWNER_POLICY_APPROVAL_RECORD.md`.
- `docs/compliance/tiktok-shop/SECURITY_CONTROL_EVIDENCE_MATRIX.md`.

The HTML policy body text matches the approved Markdown after Markdown rendering. The PDF contains the same approval status/date and key media, OAuth, provider, and recovery limitations. The HTML states approval does not prove deployment or operational verification and does not imply TikTok approval.

The page includes the business name, MEI legal operator, CNPJ, municipality/state, and security contact. It does not include CPF or residential address. A local scan found no credential-like tokens, bearer credentials, private-key blocks, or service-role literals. The page contains no script tags or forms and has no authentication dependency. Internal repository references are plain text; navigation links to the Privacy Policy and Terms are separate.

## 3. Page security and route

- `lang="en"`, viewport metadata, a single H1, a skip link, `main` landmark, labelled navigation, visible focus styling, responsive CSS, and a print stylesheet are present.
- HTML5 parsing: zero parser errors.
- Local Playwright preview at `http://127.0.0.1:4178/security-policy.html`: HTTP 200 at 1440 px and 390 px widths; no horizontal overflow; one H1; no v3.0 wording; separate Privacy Policy link.
- Local preview confirms the static path in Vite preview only. Vercel rewrite precedence and the remote route were not tested. The static file exists at the Vite public root and is copied to `dist/security-policy.html`; the configured catch-all rewrite makes a Vercel Preview deployment a required route check before promoting a production alias.
- Links to the external home URL and mailto address were not remotely tested. Local Privacy Policy and Terms files exist.
- Automated WCAG/axe testing and screen-reader testing were not run. Structural and responsive checks are not a full accessibility certification.

## 4. Commands and results

| Command/check | Result | Boundary |
|---|---|---|
| `git branch --show-current` | `main` | Local only |
| `git rev-parse HEAD origin/main` | Same commit `0c3a6694...` | Does not establish deployed commit |
| `git status --short` | 40 tracked modifications; 210 untracked files | Includes substantial unrelated work |
| `npm run build` from `apps/web` | PASS; TypeScript and Vite production build completed | Built the complete app from dirty local source and local environment |
| `find apps/web/dist -maxdepth 3 -type f` | 56 output files | Full-site artifact |
| SHA-256 of page and built page | Both `fb5a039a...`; exact match | Local artifact only |
| Local Playwright preview | PASS at 1440 px and 390 px; route HTTP 200; no horizontal overflow | Not Vercel route proof |
| HTML5 parser / structure / links | PASS; zero parse errors; local links resolve | No full WCAG audit |
| Secret-pattern scan of page and non-public build env values | No findings | Public VITE configuration remains embedded by design |
| `git diff --check` | PASS | Whitespace check only |

## 5. Risks and blockers

1. **High — unrelated application changes:** deploying the current dirty build would publish application code generated from 18 modified and 13 untracked web files, in addition to the policy page. This exceeds the authorized document-only scope.
2. **High — unknown Vercel target/baseline:** no local project linkage or remote settings are available. The configured root, production branch, environment scope, and currently deployed commit are unverified.
3. **Medium — environment mismatch:** the local Vite build uses root `.env.local`; public Supabase configuration is embedded in the app bundle. It was not proven to match the production Vercel environment.
4. **Medium — route behavior:** local Vite preview serves the page at the expected path, but Vercel-specific interaction with the catch-all rewrite has not been verified.
5. **Residual — public status and questionnaire:** local HTML is reconciled, but remote publication has not been established. TikTok submission readiness and external evidence remain separate decisions.

## 6. Isolated publication strategy (proposal only)

1. Obtain an owner-authorized, sanitized record of the exact currently deployed production commit and verify the Vercel project's Root Directory and build settings in a separately authorized workflow.
2. Create a clean isolated worktree/branch from that verified production commit; do not use this dirty worktree or copy untracked files into the deployment context.
3. Apply only the reviewed `apps/web/public/security-policy.html` patch. Require the source-control diff to contain exactly that file and no environment/config changes.
4. Build in a clean environment using the intended Vercel-scoped public environment values; do not copy `.env.local`. Confirm the generated `dist/security-policy.html` hash matches the reviewed source. Review the complete build manifest because the deployment artifact still contains the full app from the verified baseline.
5. Use an authorized Preview deployment first. Verify `/security-policy.html`, other legal routes, `/`, the media rewrite, headers, and absence of unintended application changes. Review the preview before separately authorizing production promotion.
6. Production publication requires a separate explicit authorization and an independently reviewed artifact/deployment record. No commands are run as part of this report.

If the exact deployed baseline or production project settings cannot be established, remain **NO-GO**. A standalone one-file Vercel project would not update the existing site safely at the existing path and is not a substitute without separate architecture approval.

## 7. Rollback plan (future, not executed)

- Before promotion, record the last known-good production deployment and its commit/artifact identifier.
- If the new deployment serves incorrect content, breaks routes, or changes app behavior, stop further promotion and restore the prior known-good deployment/alias using the authorized Vercel rollback procedure.
- If platform rollback is unavailable, redeploy the exact prior production commit through the approved pipeline; do not revert unrelated work in the current worktree.
- Recheck `/security-policy.html`, `/`, privacy/terms paths, headers, and application health after rollback.
- Retain deployment logs and compare the actual artifact; do not claim rollback verified until tested under separate authorization.

## 8. GO/NO-GO

- **Policy content for human review:** GO; local Markdown/PDF/HTML parity verified.
- **Current worktree/build for publication:** **NO-GO**; unrelated frontend changes and local environment inputs are included in the full-site build.
- **Request human authorization for an isolated Preview preparation:** GO, conditional on first confirming the actual Vercel project/root and deployed baseline.
- **Request authorization for production publication now:** **NO-GO** until the isolation conditions above and Vercel route Preview checks are satisfied.
- **Deploy executed:** NO.
