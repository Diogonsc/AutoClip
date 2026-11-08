# Phase 1B readiness

**NO-GO.** Before implementation: confirm BR Seller authorization host, service ID, registered callback, Seller token response/refresh semantics, Get Product route/version, and generated SDK scope availability. Configure Sandbox secrets only in Supabase Edge Functions; test migration/RLS in disposable Supabase; then run a read-only Sandbox OAuth → shops → products flow. Keep `TIKTOK_SHOP_ENABLED=false` until owner approval and successful homologation.
