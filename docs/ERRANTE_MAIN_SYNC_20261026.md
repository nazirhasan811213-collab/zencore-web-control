# Errante parity audit — 26 October 2026

Source of truth: original main commit `7246798441042d83839653c0af8e5b59468a91be` (latest original live deploy when audited). Errante baseline: `160129ae200d59a0b4466c45fcbbaf75b6dd4d36`.

Imported all outstanding main changes, including TF2 ATR8 price-distance caps (TP1 1.50, TP2 2.30, TP3 3.50, SL 2.00), broker-confirmed close-cycle re-entry, corresponding Pine/Telegram identities, server-side eligibility callback and regression coverage. These are maximum distances under the main policy, not a promise that every ATR-derived plan uses the full distance. TF15 follows the original main policy.

Audit of the remaining differences from main:

- HTML pages, workspace shell and promotion links: exact equality after substituting Errante branding/domain back to the original.
- `analysis-alert-service.js`: only the Errante health-message link differs.
- `auto-trade-service.js`: only the previously authorized 60-second automatic-management hold differs.
- `server-analysis.js`: only isolated Errante admin/client bootstrap hooks and readiness product/preparation labels differ.
- EA and connector: only Errante magic IDs, local directory/channel/startup identity, destination URL/labels and the authorized 60-second EA hold differ.
- Package metadata/start command and dedicated bootstrap modules preserve the Errante database boundary and preparation gates. The client-bootstrap environment was cleared after the two requested users were created; source never resets existing passwords or extends access on restart.
- Errante-only tests cover the preceding branding, transport isolation, access and hold differences. Original tests for position management use fills aged at least 60 seconds in Errante.
- Previous Errante deployment notes are retained as historical documentation.

All other tracked main source files are unchanged in the merged tree. Sender/receiver relay implementation is identical; the original sends and Errante receives through their independent environment settings. No user records, broker credentials, Telegram tokens, database connections or original trading controls are copied.

Validation: Node 704 tests, 698 passed and 6 PostgreSQL integration tests skipped without a test database; Python connector 67 tests, 66 passed and 1 skipped. No changes to the original service are needed for this synchronization. Errante auto-trade remains OFF and entries PAUSED. Runtime deployment, public shared-asset hashes and live relay receipt are checked separately after publication. Installed MT5 binaries and demo order execution are not validated by source synchronization.
