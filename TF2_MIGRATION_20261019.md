# TF2 scalping migration — 19 October 2026

Replaces only the active scalping timeframe, TF3 → TF2. TF15 is unchanged.

The new `ZenCore_TF2_Scalp.pine` is derived from the latest TF3 script. Native held SOLID, matching Movement and own HEMA ribbon, any 3/4 confirmations, Chop <50, own-timeframe HEMA checklist, ATR14, minimum SL distance 3.00, native Fixed R:R/Fibonacci and Pine StepLock remain unchanged. TF2 MTF uses 3/5/10 as requested; TF15 retains 15/30/45. First execution is immediate on qualification; retries retain the original 60-second authorization and setup identity. There is no new waiting timer.

The application accepts only the new TF2 ribbon version for active scalping orders. Old TF2 policies cannot authorize scalping via this configuration. TF3 ingestion remains for setup-scoped management of open positions; TF3 emits no new entry events. Both normal entry and re-entry remain blocked while any own scalping position exists. Full MT5 close confirmation and fresh post-close evidence remain mandatory for the next cycle. TF15 ownership remains separate.

Dashboard, analysis stream, monitoring, Telegram and execution delivery now recognize TF2. Telegram retains the current action layout and omits the removed exit explainer.

## Activation

1. Build and install Connector 2.1.4 so TF2 ribbon metadata, exact timeframe and Pine exit-lock version reach the existing EA 2.11. EA source is unchanged.
2. Deploy the reviewed application branch.
3. On XAUUSD standard 2-minute candles, install `ZenCore_TF2_Scalp.pine`, Scalping mode. Keep the existing private webhook secret.
4. Recreate one Unified alert with Any alert() function call and the existing webhook URL. TradingView alerts retain their saved script version; changing chart timeframe alone does not migrate them.
5. Retain TF3 management feed for old open TF3 setups until closed. Application rejects their entries. Remove that feed after the old positions close.
6. Confirm `/sop-version` reports active scalping 2, TF2/TF15 feeds are fresh, and authenticated MT5 activity reports the intended side/timeframe. Do not create forced test trades.

No account ON/OFF state, account binding, password, lot/layer setting or broker authorization is changed. No live deployment or TradingView/Pine compilation is implied by local tests. Reverting requires matching application, Pine alerts and Connector; preserve existing broker SL and setup management.
