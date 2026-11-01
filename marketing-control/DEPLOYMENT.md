# Deployment and integrations (NOT LIVE)

## Existing production safeguards
The existing ZenCore trading app runs on Render from `main`. Do not change that service, its deployment branch, or MT5 configuration. The Marketing Control code is on `feature/ai-marketing-founder-approval` only.

## Private draft-only service
1. Use a separate private host or internal Render service with persistent storage; do not use temporary disk for approval evidence.
2. Build command: `cd marketing-control && npm test`.
3. Start command: `cd marketing-control && node server.mjs` (currently bound to loopback only).
4. Generate two independent high-entropy secrets: `MARKETING_FOUNDER_KEY` and `MARKETING_AGENT_KEY`; set `OPENAI_API_KEY` and a private `MARKETING_STORE` path.
5. Restrict dashboard to Founder using authenticated reverse proxy/TLS and rate limits. Separate staff access from the MT5 API and credentials.
6. Confirm backups, rotation, audit retention and production database before serving real users.

## Social media gateway
Connect Facebook Page, Instagram Professional and TikTok through each platform's official authorization flows. Account owners must authorize these links interactively. Do not store social passwords. Verify rate limits, content format, platform permissions, app-review requirements and API terms.

**Fail closed:** No social publishing adapter is enabled in this branch. The release-grant endpoint is a preview of the authorization contract, NOT a publishing operation. A publication operation must require an immutable reviewed asset hash, exact channel, explicit Founder release, expiry, single-use consumption in a transaction, revocation support and detailed audit. A feature flag alone must never bypass these controls.

## Automation
An n8n workflow may call `/api/marketing/campaign-preview` and `/api/marketing/ai-draft` using AGENT key from n8n credentials. It must not call release, publish, send DM or spend advertising funds. Set conservative monthly token caps, queue retry and alerting on failure.

## 19 October 2026 launch
Finalize the Founder-reviewed campaign, validate genuine product footage, review applicable advertising rules, and run dry-run QA. Do not schedule or publish any launch materials until a per-item approval and separate explicit release has been given.

## Current limitations
No integrated social publisher, automated video compositing from recordings, full 8 independent LLM agent runtimes, daily cloud scheduler or production-ready shared database yet. Foundation code is not a production completion claim.
