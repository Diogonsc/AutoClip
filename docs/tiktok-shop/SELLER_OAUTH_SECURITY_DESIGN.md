# Seller OAuth security design

Seller OAuth is isolated from Creator and Content Posting. The backend creates a cryptographically random state bound to workspace, authenticated user, Seller connection and expiry; callback consumes it atomically once. The callback accepts only the registered Redirect URI, validates `code`, state, `user_type=0` and granted scopes, then encrypts tokens with AES-GCM using connection-bound AAD. Never return tokens to the browser or log query strings.

Refresh uses a lease/fencing token, persists rotated credentials atomically, and marks the connection `REAUTH_REQUIRED` on revoked/ambiguous refresh. API hosts and authorization hosts use backend-controlled allowlists; no frontend-supplied redirect or host is accepted. Missing scopes, token invalidation, and deauthorization produce reauthorization rather than fallback to Creator tokens.
