# First-launch Edge Function allowlist

For the initial Login Kit + Content Posting release, deploy only the function names in
[`edge-functions-first-launch.txt`](./edge-functions-first-launch.txt), individually
and with an explicit project ref after a separate deployment authorization.

Excluded Shop functions:

- `tiktok-shop`
- `tiktok-shop-oauth-callback`
- `tiktok-shop-publish`

The allowlist is intentionally a list of explicit names, not a wildcard. Do not use
`supabase functions deploy` without a function name, `--all`, or an equivalent
deploy-all command. The repository currently has no GitHub Actions deployment
workflow; rerun `node --test scripts/test_tiktok_shop_isolation.mjs` whenever this
manifest or deployment automation changes.

Omitting a function from a future deploy does not disable an older already-deployed
copy. The database migration, server-side guards, and an authorized remote inventory
of existing functions must all be complete before claiming Shop is unavailable in a
remote environment.
