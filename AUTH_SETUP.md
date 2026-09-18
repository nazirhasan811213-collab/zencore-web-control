# ZenCore Phase 1 — Login and Register

Phase 1 adds a PostgreSQL-backed account layer in front of the existing Precision Entry analysis stack.
The Analysis Page, Pine payload, Normal 3M SOP V32, EXIT 32.3 StepLock and 11-market feed are unchanged.

## Safe rollout

Authentication is disabled by default. With `ZENCORE_AUTH_ENABLED` unset, the current `/` Analysis Page behaves exactly as before.

Before enabling authentication on Render, attach a PostgreSQL database and configure:

```text
SITE_MODE=precision-entry
DATABASE_URL=<Render PostgreSQL internal URL>
ZENCORE_AUTH_ENABLED=true
ZENCORE_REGISTRATION_ENABLED=true
```

Optional settings:

```text
ZENCORE_SESSION_TTL_MS=604800000
ZENCORE_REGISTRATION_ENABLED=false
```

Do not set `ZENCORE_INSECURE_COOKIE` on Render. Secure cookies are enabled by default.

When authentication is enabled:

- `/` sends a signed-in user to `/app` and everyone else to `/login`.
- `/login` and `/register` are public account pages.
- `/app` is the Page Utama Market Radar for all 11 supported markets.
- `/analysis` is the protected existing Analysis Page.
- `/results` is the protected 11-market signal-validation Result Page.
- Analysis APIs and live event streams require a valid user session.
- `/webhook` remains public at the network layer because TradingView must reach it; the existing webhook secret validation remains inside the analysis stack.
- `/health` remains public for Render health checks.

## Local development only

For a temporary in-memory test store over local HTTP:

```bash
SITE_MODE=precision-entry \
ZENCORE_AUTH_ENABLED=true \
ZENCORE_AUTH_MEMORY=true \
ZENCORE_INSECURE_COOKIE=true \
PORT=18080 \
npm start
```

The memory store is blocked when `NODE_ENV=production` and must never be used for a real deployment.

## Security decisions

- Passwords use Node.js `scrypt` with a unique random salt.
- Raw passwords and session tokens are never stored in PostgreSQL.
- Session cookies are `HttpOnly`, `Secure` and `SameSite=Strict` in production.
- Registration and login requests have same-origin checks and rate limiting.
- Duplicate-email errors never expose passwords or session data.
- MT5 credentials and Auto Trade are not part of Phase 1.
- Result history is engine validation held in server memory; it is not user-specific broker P/L and may reset on service restart.
