# ZenCore AI Marketing Control — Founder Approval First

Independent local-only Node 20+ microservice, on a **feature branch only**. Does not touch or deploy ZenCore MT5 or its live trading engine.

## Non-negotiable security rule
**Every single post, caption, video, poster, paid ad, customer message, campaign launch, and publication requires explicit Founder approval before any public release.** No automatic approval. Agents can only create/submit drafts.

* Default = DRAFT ONLY, independent of any environment variable.
* No connected publisher; `/publish` always returns 423 Locked, including after approval.
* Founder tokens and Agent tokens must be distinct and secret.
* Local loopback binding only; place behind authenticated reverse proxy only after security review.
* Approved content is NOT published. Publisher adapter and one-time explicit release gate require a later separately reviewed implementation.
* Secrets, MT5 credentials and trading execution are outside the module.
* No auto-DM or unsolicited outreach.

## Run locally (no production launch)
```bash
export MARKETING_FOUNDER_KEY='a-long-random-founder-secret'
export MARKETING_AGENT_KEY='another-long-random-agent-secret'
cd marketing-control && npm test
npm start
```
API: `POST /api/marketing/drafts` (either role), `POST /api/marketing/items/:id/submit` (either role), `POST /api/marketing/items/:id/approve` or `reject` (Founder only), `GET /api/marketing/items`, `GET /api/marketing/audit` (Founder only).

Example draft JSON: `{"title":"ZenCore reveal","caption":"Kenali ZenCore 19 Oktober 2026. Trading involves risk.","channel":"facebook"}`.

## Delivery roadmap (not yet implemented)
1. Founder-only authenticated dashboard with detailed preview of media, caption, destination, scheduled time, audience and disclosure before approval.
2. Agent orchestrator: marketing director, strategy, copywriting, designer, video, social, leads, analytics, compliance; API cost ceiling and brand facts registry.
3. Media renderer based on *actual* ZenCore captures, not invented profits; consent and licensing controls.
4. Official Buffer/Meta/TikTok integrations, constrained platform compliance, OAuth vault, and publish approval tied to immutable content hash. Reapproval on ANY edit.
5. Separate authorization for each publishing action, ad budget and DM; idempotency keys, rate limits, retries, kill switch, analytics.

This is **core approval workflow scaffolding**, not a completed full AI marketing team or a live deployment.
