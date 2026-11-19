# ZenCore TF1 Native SOLID HEMA — 19 November 2026

Scalping now uses actual one-minute Pine bars and `TF1_REALTIME_V1` from the owner's uploaded Native SOLID V7.1 source. XAUUSD and BTCUSD have separate feed, chart, setup, signal, sizing and execution identities. TF15 remains an independent intraday strategy.

## Entry

- BUY requires HEMA20 above HEMA40 (green ribbon).
- SELL requires HEMA20 below HEMA40 (red ribbon).
- Flat, missing or opposite HEMA cannot authorize TF1 entry, including the direct-entry path.
- Native SOLID qualification and original TP/SL calculations are retained from the uploaded Pine. No new quality-score threshold is added.
- Dashboard messages cannot create orders. Only Execution messages can authorize an entry.
- TF2 feeds and queued TF2 entry commands cannot become new TF1 entries.

## Compatibility and exits

`TF2_SCALPING` remains the internal saved-settings / signed EA strategy slot. This is intentionally not the feed timeframe: new order snapshots explicitly carry `executionTimeframe: "1"`. Keeping this identity preserves per-client lot, layers, pair selection, MT5 magic numbers, persisted local protection and manual exit settings. Manual exit wire version identifiers are also preserved.

The executor continues managing existing fills and local protection after an update. A confirmed TF1 native close may target an already executed TF2 setup through the management path only; its original setup identity, levels and fill data are preserved. Merely changing timeframe never closes a position.

## Installation

1. Install Connector 2.1.44 for a single PC, or VPS Manager 1.1.28 for the shared Windows VPS. Both carry EA 2.44. Preserve the existing account/profile bindings; do not reset accounts.
2. Use Pasang EA to update ZenCoreExecutor in each active MT5 terminal and verify EA 2.44 is attached and Algo Trading is enabled.
3. Replace the TradingView scalping indicator with `ZenCore_TF1_SOP_V7.pine` on the one-minute XAUUSD and BTCUSD charts.
4. Recreate each relevant TradingView alert using the updated indicator. Existing TradingView alerts retain their script snapshot. Preserve the configured webhook URL, secret and Execution/Dashboard channel selection. Remove old TF2 alerts after replacement.
5. Refresh ZenCore. Dashboard, Analysis, chart selectors, Telegram labels and Auto Trade show TF1 and TF15.

Deployment of the web service does not remotely replace an EA on a user's Windows computer or recreate TradingView alerts. Broker fills require a connected terminal, enabled trading permissions and a broker-accepted order.

## Verification

Offline tests cover both pairs and both directions through compact feed decoding, analysis, signed command queue, real Connector mailbox serialization, exit routing, duplicate handling, HEMA rejection, TF1/TF15 isolation and unchanged user sizing. Windows CI compiles all EA variants, builds both installers and smoke-tests install/uninstall. No synthetic signal is sent to a live broker account.
