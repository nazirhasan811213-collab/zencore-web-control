# TF2 unfilled setup return — draft

Opt-in feed: `TF2_3GREEN_TP1_HEMAGAP_V1` with `pendingEntryReturn:true`.

- Minimum 3/5 green. BUY NEUTRAL >50 or BULLISH >40; SELL NEUTRAL <50 or BEARISH >40. TF2/TF3 HEMA direction and provisional width >10% TF2 ATR remain.
- Unfilled setups survive chart TP1, TP2 and virtual StepLock close. Entry is allowed only after price is inside the original entry-to-TP1 interval and all live SOP checks pass. Original SL breach or replacement setup invalidates the latch.
- Pine emits once per setup, bootstrap never replays history, command dedupe and actual-position guards remain. This does not add batches to an already traded setup. Failed dispatch retry/acknowledgement reconciliation is not added by this policy.
- TF15 and legacy feeds retain their original policy.

## Exact fill-anchored targets — specification, not integrated

`live-entry-levels.js` implements and tests the pure calculation: retain each original signed TP/SL distance, replace the anchor with actual fill. Example BUY plan entry 4000 / SL3997 / TP4002,4004,4006 filled at4001 gives SL3998 / TP4003,4005,4007.

Exact MT5-fill anchoring is not possible in the unchanged EA: it receives fixed targets, modifies SL distance to80%, and stores shared target levels before filling layers. Implementing the requested behavior requires EA fill/result handling and per-position target storage, plus server management that uses those stored levels rather than chart targets. Connector protocol integration must be reviewed. The helper is intentionally not wired to live dispatch; anchoring to TradingView price would not meet the exact-fill requirement.

Earlier user instruction prohibits changing Connector and EA. Those files remain unchanged. Pine not compiled in TradingView; revision not deployed. Tests establish rule behavior, not profitability or end-to-end broker execution.
