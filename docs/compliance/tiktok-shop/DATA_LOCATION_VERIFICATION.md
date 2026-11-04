# Data Location Verification — TikTok Shop Review

**Review date:** 2026-11-02
**Selected questionnaire answer in supplied transcription:** United States.
**Verification:** not independently confirmed. No Cloud, Vercel, Partner Center or provider dashboard was accessed.

## Local evidence

| Service/data path | Repository evidence | What is not established |
|---|---|---|
| Supabase project/PostgreSQL/Auth/Edge Functions | Supabase is the documented backend; local `supabase/config.toml` has a local project alias. The application config references a project endpoint, but this says nothing reliable about region. | Actual Cloud project region, replicas, backups, logs, support access and subprocessor locations |
| Supabase Storage | Local app and policies reference a media bucket | Bucket region, object replication, backup region, support/processing access |
| Vercel web hosting | Architecture/docs identify Vercel and a declared project URL | Deployment region/edge processing, logs/analytics, image/cache processing and account configuration |
| TikTok / TikTok Shop | OAuth and publishing integrations exist in local source; content/account data is sent to those platforms when authorized | Actual storage/processing countries, API feature data path, retention, support access and applicable transfer terms |
| Email/security contact | Local policy/runbook specifies a contact channel | Mail provider, mailbox location, forwarding, retention and access |
| Backups and logs | Local docs discuss these systems | Whether enabled, scope, location, retention, replication and region |

## Conclusion

The United States selection is an owner-supplied form value, not a location finding established by the local repository. The only region-like values found locally are application/project identifiers and service URLs; they are not sufficient evidence of storage or processing location. Do not list additional countries or confirm the United States answer until the owner checks each relevant service's project/deployment region and its backup, logging and subprocessor locations.

## Owner verification worksheet

| Provider/service | Project/account identifier (store privately) | Primary region | Logs/backups/replicas regions | Processing/subprocessor countries | Evidence/date/reviewer |
|---|---|---|---|---|---|
| Supabase Database/Auth/Functions | [PRIVATE] | [TO VERIFY] | [TO VERIFY] | [TO VERIFY] | [PENDING] |
| Supabase Storage | [PRIVATE] | [TO VERIFY] | [TO VERIFY] | [TO VERIFY] | [PENDING] |
| Vercel | [PRIVATE] | [TO VERIFY] | [TO VERIFY] | [TO VERIFY] | [PENDING] |
| TikTok / TikTok Shop | [APP/SELLER SCOPE TO VERIFY] | Provider-specific | Provider-specific | [TO VERIFY FROM CURRENT TERMS] | [PENDING] |
| Email and monitoring | [PRIVATE] | [TO VERIFY] | [TO VERIFY] | [TO VERIFY] | [PENDING] |

Capture only sanitized settings or provider terms. Do not include account secrets, user records, signed URLs or access tokens. Reconcile the completed worksheet with the public privacy notice before resubmission.
