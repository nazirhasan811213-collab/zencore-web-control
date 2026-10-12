# TF2 revised entry policy — draft

Opt-in feed tag: `TF2_3GREEN_TP2_HEMAGAP_V1`.

- Checklist: minimum three of five green conditions.
- HEMA20/40 on TF2 and TF3 must both agree with the setup direction.
- Each ribbon must have an absolute fast/slow gap greater than 10% of TF2 ATR. Equal or smaller gaps block entry as sideways. Missing ATR or HEMA data blocks entry. This is a provisional numerical interpretation of the screenshots, not a validated profit threshold.
- Forecast: BUY accepts NEUTRAL >50% or BULLISH >40%; SELL accepts NEUTRAL <50% or BEARISH >40%. Boundaries are strict.
- After a realtime TP1 excursion, price must return inside the original entry-to-TP1 interval and all current SOP checks must pass. A fresh event timestamp distinguishes a new return entry from replayed delivery. Existing EA active-position guards still prevent adding another batch while TF2 positions remain open.
- A latched setup remains available after TP1 and expires at TP2. Existing solid-latch, forecast, freshness and ATR40 pullback checks remain.
- Existing EA rejects new entries at or beyond TP1. The server therefore displays WATCH after TP1 and sends neither an execution command nor a Telegram ENTRY. Actual entry from TP1 to TP2 remains unsupported without a separate EA change; target prices are never relabelled to bypass this restriction.
- Legacy feeds keep four green conditions and TP1 expiry. TF15 policy, Connector and EA are unchanged.

Updated canonical feed and generated TF2 chart are source drafts. Pine has not been compiled in TradingView and this revision has not been deployed. Automated tests validate policy and execution guards, not profitability or broker execution.
