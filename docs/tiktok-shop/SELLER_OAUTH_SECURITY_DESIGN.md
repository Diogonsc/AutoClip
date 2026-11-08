# Seller OAuth security design

Persist only a SHA-256 state hash, workspace/user binding, expiry and single-use consumption. Callback must validate configured redirect, consume state atomically, validate Seller identity/scopes, and encrypt tokens with connection-bound AES-GCM AAD. Refresh must use existing fencing/atomic persistence and reauthorize on ambiguity or revocation.
