# Phase 1B.2A readiness

Local migration proposes hashed, one-time OAuth states; workspace-bound Seller metadata; backend-only encrypted credential fields and RLS. It is **not applied**. Before deployment, add transactional state claim/persistence RPCs, audit events/shops, test RLS against disposable PostgreSQL, and validate callback routing: the registered Vercel callback must be distinguishable from Content Posting or a dedicated Seller Redirect URI must be registered.

**NO-GO:** no remote migration, callback, scheduler, or Sandbox validation has occurred.
