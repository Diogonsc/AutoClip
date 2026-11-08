# Seller OAuth contracts — 2026-11-08

| Contract | Status | Evidence |
|---|---|---|
| Seller authorization | Partially confirmed | Official guide: `services.{region}.tiktokshop.com/open/authorize`, `service_id`; state should be supplied by AutoClip. Exact BR host and redirect configuration: pending Partner Center. |
| Callback | Pending | `code`/`state` pattern is documented for OAuth; exact Seller denial parameters require Sandbox confirmation. |
| Token exchange | Pending Seller confirmation | Official token guide documents `GET https://auth.tiktok-shops.com/api/v2/token/get`, `app_key`, `app_secret`, `auth_code`, `grant_type=authorized_code`; Seller must validate `user_type=0`. |
| Refresh | Pending Seller confirmation | `GET /api/v2/token/refresh`, `refresh_token`, `grant_type=refresh_token`; refresh rotation/TTL must be observed in Sandbox. |
| Shops | Observed manually | `GET /authorization/202309/shops`, response uses `id` and `cipher`. |
| Products | Observed manually | `POST /product/202502/products/search`; `page_size=20` returned a product. Public reference currently exposes 202309, so account-specific SDK is authoritative. |
| Get Product | Pending | Tool succeeded manually; route/version not yet frozen. |

Sources: https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c ; https://partner.tiktokshop.com/docv2/page/tts-developer-types ; https://partner.tiktokshop.com/docv2/page/6503081a56e2bb0289dd6d7d
