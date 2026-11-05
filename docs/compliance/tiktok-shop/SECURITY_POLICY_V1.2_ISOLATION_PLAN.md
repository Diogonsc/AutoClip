# Security Policy v1.2 — Safe Deployment Isolation Plan

**Prepared:** 2026-11-02
**Scope:** Local-only inspection and deployment planning. No fetch, remote Vercel access, Preview, deployment, commit, push, migration, or production change was performed.

## 1. Decision summary

**Production baseline: NOT CONFIRMED.** The only local baseline available is Git commit `0c3a6694b24463e5522fca959e7fb335a9e18225`, checked out on `main` and also present in the local `origin/main` tracking ref. This does not prove the commit currently deployed on Vercel.

**Do not create the definitive release worktree or build from the current dirty tree.** The production deployment commit and Vercel Root Directory/project linkage require a separately authorized read-only verification. This gate stops before that step.

## 2. Local Vercel/Vite configuration

- `apps/web/vercel.json` declares framework `vite`, build command `npm run build`, output directory `dist`, a `/m/:token` rewrite to the Supabase media function, an SPA catch-all rewrite to `/index.html`, and global security headers.
- `apps/web/package.json` defines `build` as `tsc --noEmit && vite build`.
- `apps/web/vite.config.ts` configures React/Tailwind/Vitest and sets `envDir` to the repository root.
- No `.vercel/project.json`, `.vercelignore`, or `now.json` was found. The Vercel CLI was not installed locally.
- The local files suggest that Vercel is intended to build from `apps/web`, but the actual project Root Directory, project ID, production branch, environment-variable scopes, domain assignment, and deployed commit are not available in the repository and remain **NOT VERIFIED**.

The normal Vite output is a full static site/application bundle, not a single-file patch. The prior local build produced 56 files (SPA entry, JS/CSS/font bundles, and public assets). Vercel deployments are therefore to be assessed as complete-site releases even when the source diff is one HTML file.

## 3. Git and target-page evidence

- Branch: `main`.
- `HEAD`: `0c3a6694b24463e5522fca959e7fb335a9e18225`.
- Existing local refs: `origin/main` and `origin/HEAD` point to the same commit; no fetch was performed.
- Configured Git remote is `origin`; remote refs are local cached refs only and are not deployment evidence.
- At inspection, 40 tracked files were modified and 210 files were untracked across the repository; `apps/web` contained 18 tracked modified files and 13 untracked files. These unrelated changes must not enter a policy-only release.
- The approved page differs from `HEAD` by 83 insertions and 620 deletions in `apps/web/public/security-policy.html`. This is the requested policy reconciliation; the policy page is not yet committed.
- Approved Markdown SHA-256: `a7dd38ebed4d39907fe75a1991ed4d29955d673f20341122ede6c6196c68eaf0`.
- Approved PDF SHA-256: `250dc7e766286b439f2b2ce33011e3148fcd3645731f3ee900a4e3ec87ff29d6`.
- Reconciled HTML SHA-256: `fb5a039a0b9234bf81329bbad714595af2acbdbaaaacbb55ce4aa5c233a4609b`.
- Local comparison verified that the rendered HTML policy body equals the approved Markdown text. The approval date, entity, contact, and limitations agree with the local PDF and approval record.

The baseline shown by local Git is known; the production baseline is not. Do not infer that `origin/main` is deployed.

## 4. Recommended isolated procedure (not executed)

Proceed only after a separately authorized, sanitized confirmation supplies the exact production deployment SHA and verifies the Vercel project and Root Directory.

Illustrative local isolation commands, requiring future approval before use because they create a Git worktree and copy a file:

```bash
PRODUCTION_SHA='<exact SHA verified from the authorized Vercel deployment record>'
RELEASE_DIR='../AutoClip-policy-v1.2-release'

git worktree add --detach "$RELEASE_DIR" "$PRODUCTION_SHA"
git -C "$RELEASE_DIR" status --porcelain
install -D -m 0644 \
  apps/web/public/security-policy.html \
  "$RELEASE_DIR/apps/web/public/security-policy.html"
git -C "$RELEASE_DIR" diff --check
git -C "$RELEASE_DIR" diff --name-only "$PRODUCTION_SHA" --
sha256sum "$RELEASE_DIR/apps/web/public/security-policy.html"
```

Acceptance condition: the only changed path is `apps/web/public/security-policy.html`, and its hash equals the reviewed HTML hash above. If that path differs materially at the production SHA, stop and reconcile the page manually; do not overwrite intervening changes blindly.

Then, in a separately approved local validation step, install dependencies from the baseline lockfile in that isolated worktree and run the declared build. Do not copy `.env.local`. Review the complete output manifest and compare it to the same baseline build; only `dist/security-policy.html` should differ at the static document level, while application bundles should be identical. The build must use the intended Vercel Preview environment rather than production values. A clean local build is still not proof of Vercel's remote build artifact.

Only after review and separate authorization could a dedicated branch/commit containing the one-file patch be pushed through the configured Git integration to produce a Vercel Preview. Preview must verify the project/domain association, `/security-policy.html`, `/`, all existing legal pages, headers, and the `/m/:token` route without testing or publishing real media. Production promotion requires a further explicit authorization. No such branch, commit, push, Preview, or production action is authorized here.

## 5. Acceptance criteria

| Check | Required evidence | Current status |
|---|---|---|
| Baseline is production's current deployment | Authorized Vercel deployment record identifies exact SHA; compared locally | **BLOCKED — not locally available** |
| Vercel target is correct | Project linkage, Root Directory, domain and production branch match expected site | **NOT VERIFIED** |
| Change is limited to page | Isolated worktree diff names exactly `apps/web/public/security-policy.html` | **PENDING isolation** |
| Policy body matches approved v1.2 | Rendered HTML text compared with approved Markdown; approval/PDF metadata agree | **PASS locally** |
| Build is reproducible | Two clean builds from same baseline and environment yield matching normalized manifest | **PENDING** |
| No secrets in artifact | Scan static output; Vercel environment variable names/scopes reviewed without exposing values | **PARTIAL locally; remote environment pending** |
| No new functionality | Application bundles match baseline build; only public policy asset changes | **PENDING isolated comparison** |
| Public assets preserved | Compare all `public/` assets against baseline; only security page differs | **PENDING** |
| Preview configuration/routes correct | Authorized Preview verifies expected domain/path, SPA and rewrites | **PENDING remote authorization** |
| Rollback ready | Known-good prior deployment/alias and recovery procedure recorded before promotion | **PENDING production evidence** |

## 6. Rollback plan

Before any future production promotion:

1. Record the last known-good deployment URL/ID and its exact source SHA through an authorized Vercel procedure.
2. Retain the policy-only release SHA, build manifest, preview evidence, and approval record.
3. If content or routes are wrong, stop promotion and restore the recorded known-good deployment/alias using the approved Vercel rollback procedure.
4. If platform rollback cannot be used, redeploy the exact prior production commit through the approved pipeline; do not reset or revert the present worktree.
5. Recheck the policy route, home route, privacy/terms pages, response headers, and application health.
6. Record the rollback outcome. Do not claim rollback verified until this has been exercised in an authorized environment.

## 7. Risks and blockers

- **BLOCKER:** current production deployment SHA is not available locally. The repository's `main`/`origin/main` ref is not proof of production state.
- **BLOCKER:** Vercel project linkage, Root Directory, production branch, domains, and environment settings are not locally verifiable.
- **HIGH:** current worktree includes many unrelated changes; its full-site build must not be deployed.
- **HIGH:** building from the present worktree uses local root `.env.local`; its values are not a substitute for Vercel Preview/Production environment configuration. No values are included here.
- **MEDIUM:** the Vercel catch-all rewrite's behavior for `/security-policy.html` has only been checked in local Vite preview, not Vercel Preview.
- **RESIDUAL:** rollback target and platform capability are not confirmed until the actual deployment is identified.

## 8. GO/NO-GO and next authorization

- **Local policy/content integrity:** GO; prior local parity checks pass.
- **Definitive isolation from production baseline:** **NO-GO until production SHA and project Root Directory are confirmed.**
- **Current worktree for release:** **NO-GO.**
- **Deploy/Preview/commit/push in this gate:** NOT PERFORMED and NOT AUTHORIZED.

Next human authorization needed: authorize a read-only inspection of the Vercel deployment record/settings sufficient to provide the current production SHA, project identity, Root Directory, production branch, domain, and relevant environment-variable scopes (names only; no secret values). After those facts are confirmed, a separate authorization can approve creation of the isolated worktree and local build. Preview and production publication require their own distinct approvals.
