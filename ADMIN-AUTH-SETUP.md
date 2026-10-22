# Invito Admin Authentication — staging only

This folder/repository currently contains a static-site landing page. No existing Cloudflare Worker entrypoint or Wrangler configuration was found on `develop`. Therefore `admin-auth-worker.js` is an isolated module and is **not live or wired into the website**. Do not deploy it as a replacement for the current site Worker.

## Login design

- Admin ID: configure `ADMIN_ID=admin` in the Cloudflare Worker environment.
- Password: configure only a PBKDF2-SHA-256 hash as `ADMIN_PASSWORD_HASH`, never the raw password.
- Session signing: configure `SESSION_SECRET` as a random secret with at least 32 bytes.
- Rate limiting: bind a Cloudflare KV namespace as `RATE_LIMIT_KV`. Login fails closed if this binding or any required secret is missing.
- Session cookie: HttpOnly, Secure, SameSite=Strict, 8-hour expiry.
- Routes implemented in the module: `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`.

## Configure secrets for a staging Worker

1. Create a **separate staging Worker** or add these routes to the existing Worker only after reviewing its current routing and static asset setup. Never replace the production entrypoint with this module alone.
2. Create a KV namespace for login rate limiting and bind it to the Worker as `RATE_LIMIT_KV`.
3. Set `ADMIN_ID` to `admin`.
4. Generate a random `SESSION_SECRET` using a password manager or a cryptographically secure generator; store it as a Worker secret, not in source control.
5. Generate the password hash locally in a trusted terminal by running `node scripts/generate-admin-password-hash.mjs` from a local checkout. The script hides password input and prints a value in the format `base64url(salt).base64url(hash)`, with a random 16-byte salt, PBKDF2-HMAC-SHA-256, 310,000 iterations, and a 32-byte derived hash. Set the result as the Worker secret `ADMIN_PASSWORD_HASH`. Never commit the password or generated hash to this repository.
6. Wire the handler into the existing Worker router for the three routes above, and ensure all other `/api/admin/*` management endpoints validate the same signed session on the server before reading or changing admin data. A login endpoint alone does not protect future admin APIs.
7. Serve `admin.html` from the staging host, then test correct and incorrect credentials, missing configuration, rate limiting, cookie flags, expired/invalid sessions, logout, and access to protected APIs. Use HTTPS only.
8. Only after staging checks and a code review should a pull request be considered. Production remains unchanged until explicit approval.

## Important limitations

- This module authenticates a session; it does not yet provide admin data-management endpoints or a complete protected dashboard.
- The rate limit uses a shared KV binding and is a basic throttle, not a replacement for Cloudflare WAF/rate-limiting rules.
- The code has been committed to GitHub but has not been run in a Cloudflare staging environment or subjected to a security audit.
