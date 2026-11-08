# Seller OAuth contracts

Authorization: `https://services.tiktokshop.com/open/authorize` with `service_id`; AutoClip adds backend-created state. Token exchange/refresh use `GET https://auth.tiktok-shops.com/api/v2/token/get` and `/refresh`, with the confirmed parameters and `user_type=0`. Tokens are never browser-visible. Sandbox still must validate the registered redirect and actual TTL/rotation.
