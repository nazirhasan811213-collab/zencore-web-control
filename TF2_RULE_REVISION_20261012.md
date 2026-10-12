# TF2 unfilled setup return — draft

Opt-in feed: `TF2_3GREEN_TP1_HEMAGAP_V1` with `pendingEntryReturn:true`.

- Minimum 3/5 green. BUY NEUTRAL >50 or BULLISH >40; SELL NEUTRAL <50 or BEARISH >40. TF2/TF3 HEMA direction and provisional width >10% TF2 ATR remain.
- Unfilled setups survive chart TP1, TP2 and virtual StepLock close. Entry is allowed only after price is inside the original entry-to-TP1 interval and all live SOP checks pass. Original SL breach or replacement setup invalidates the latch.
- Pine emits once per setup, bootstrap never replays history, command dedupe and actual-position guards remain. This does not add batches to an already traded setup. Failed dispatch retry/acknowledgement reconciliation is not added by this policy.
- TF15 and legacy feeds retain their original policy.

## Live signal price anchor — unchanged EA

At TF2 READY, the server retains the original signed TP1/2/3 and SL distances and translates the plan to the current live signal price. Example BUY chart entry4000 / SL3997 / TP4002,4004,4006 at live signal4001 becomes entry4001 / SL3998 / TP4003,4005,4007. This is not a guaranteed MT5 fill.

A signed execution snapshot retains both translated prices and original chart plan. Delivery rechecks current SOP, setup identity and the original entry-to-TP1 range, while keeping the already-issued targets fixed. Hosted/legacy workers are excluded for this opt-in policy.

For a rebased batch matched by stored order targets and reported strategy/side, server management ignores old chart price exits and uses reported position prices against issued TP levels. Keep existing StepLock and TP1 half-close semantics; post-entry opposite-yellow exit requires BE protection. Legacy/manual positions keep their policies. Queued old-chart management cannot execute against a rebased batch. Latest setup lookup persists through restarts.

EA and Connector files/settings remain unchanged, including existing EA SL distance factor80%, local StepLock, no additional active batch and three-candle TF2 timeout. Effective broker SL therefore remains 80% of the supplied plan distance. Spread/slippage may make actual fill differ from the signal anchor.

Tests establish rule and command behavior, not profitability or real broker execution. Pine not compiled in TradingView; revision not deployed.
