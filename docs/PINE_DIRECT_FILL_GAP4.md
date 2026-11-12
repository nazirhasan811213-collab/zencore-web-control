# Pine direct entry / fill-based plan

Scope: authenticated XAUUSD Native V7 execution events for TF2 and TF15, local EA transport (including VPS Manager). Other feed policies retain their existing behavior.

Pine qualifies the signal. Server does not recheck indicators, candle direction, session/news schedule, age, TP1 range, position-flat status or re-entry momentum for this route. Event identity, a valid ordered SL/TP plan, configured trading settings and ON/account permissions remain required. Each Pine event is deduplicated. Pending entry has no trading time deadline (a finite year-9999 timestamp preserves the existing database/envelope schema). OFF/reset cancellation and account binding remain effective.

Before EACH layer, EA compares the executable Ask (BUY) / Bid (SELL) with the signed Pine plan entry. Absolute difference >= USD4 rejects that layer. After execution it also checks the broker's actual fill. A fill outside the bound is closed best-effort and reported; a market-order fill cannot be guaranteed before execution. If close fails, the broker stop remains and EA logs the pending close. No promise of guaranteed fill/slippage is made.

For both directions, SL and every TP use the actual position fill as origin. Distances are preserved from the Pine plan: target = fill + (Pine target - Pine entry). SL is rounded toward the fill to the symbol tick grid. Each layer stores its own MT5_FILL_PLAN_V1 record. Local StepLock and existing exit semantics remain; chart SL and chart price moves cannot override that per-ticket plan.

Requires hedging mode to maintain independent positions/layers. Valid broker lot, permission, quotes and stop distances are still technical execution requirements. Different Pine events can open separate setups while another is open; duplicate deliveries cannot open the same event twice.

Deployment: install updated Connector and compile/install EA 2.23 on each terminal, then deploy server changes. The Connector advertises PINE_DIRECT_FILL_GAP4_V1 only when the EA supports it; server refuses direct dispatch without that capability. Existing entry commands are not rewritten or replayed. No MT5 binary compilation or live execution was performed in the Linux test environment.
