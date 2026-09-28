# Analysis V33 candidate — staging only

## Delivered

- All signed-in roles land on Market Radar (prior staging commit).
- Responsive Analysis workspace: context, decision checks, Entry/SL/TP1–3, then two AI comparison cards. Existing SOP views remain in an open disclosure panel, automatically promoted above the preview when the V33 feed is absent.
- One explicit generate button; no automatic paid model calls. Pair changes abort and clear the previous result. Data timestamps and expiry are visible.
- Eleven supported pairs. Closed 3M setup plus closed 1M trigger, extension gate and adaptive structure/ATR/spread/tick targets.
- Forecast strength and directional dominance are separate. Neutral >50 supports BUY; neutral <50 supports SELL; exactly 50 and CHOPPY do not enter.
- Research tracker locks a setup plan, ignores pre-entry bar extremes, handles stop-first ambiguous bars, and records a 15-minute expiry. It does not execute orders.
- Protected feed and authenticated, same-origin AI endpoint; provider failures produce explicit unavailable states.

## Activation requirements (not performed)

Use an isolated staging service and database, never the live webhook. Configure secrets through hosting settings, not repository files:

| Variable | Purpose |
| --- | --- |
| ZENCORE_V33_FEED_SECRET | Separate random feed token, at least 24 characters |
| OPENAI_API_KEY | Server-side Responses API key |
| ZENCORE_AI_MODEL | Explicit supported model selected by operator |
| TWELVE_DATA_API_KEY | Licensed external market-data API |
| ZENCORE_EXTERNAL_SYMBOLS_JSON | Explicit pair-to-provider symbol map, verified instrument by instrument |

The external panel uses Twelve Data 1-minute OHLC (UTC) to compute closed
3-minute EMA9/20 and RSI. It also shows the latest 1-minute candle close and
that candle's timestamp; this is not an MT5 broker tick. Built-in mappings cover
XAU/USD, BTC/USD and the eight listed forex pairs. US30 deliberately requires
an instrument mapping in `ZENCORE_EXTERNAL_SYMBOLS_JSON`, for example only after
verifying the exact provider instrument and access rights. Configure the API key
as a server-side Render secret. Provider credits and data licensing must be
checked for the intended display and request volume. The current integration
does not scrape other websites or claim that its calculated indicator is a
third-party trading signal.

With `OPENAI_API_KEY` and `ZENCORE_AI_MODEL` configured server-side, the GPT
button narrates the fresh external 3-minute analysis even when the separate V33
feed is absent. It explicitly describes the external-only scope; missing or
stale input does not trigger a model call. ChatGPT subscriptions do not supply
an API key or cover API usage. These variables remain unset until the service
owner provides an API account and authorizes its usage.

Compile `ZenCore_V33_Research_Feed.pine` in TradingView first. It has not been compiled in TradingView in this change. Run on a 1M chart, verify all eleven symbols and provide realistic spread inputs in price units. Zero/default spread inputs deliberately block candidate entries. Create an alert for `alert()` calls to the staging `/webhook/v33` endpoint. The bridge uses confirmed prior minutes across symbols; it can therefore lag by a minute plus transport latency. It is not a tick-level feed or a promise of zero delay. For faster confirmed data, implement an authenticated market feed with actual timestamps and bid/ask.

## Honest boundaries

- The V33 rules and target multipliers are research heuristics, not calibrated profitability estimates. Quality is not win probability. Validate per pair with spread, slippage, out-of-sample and forward data before promoting to the signal engine.
- Existing production SOP, Telegram dispatch and MT5 decisions are unchanged. No new live trades or real-user test alerts are sent.
- GPT explains supplied snapshots; it cannot manufacture missing data or override entry levels.
- External adapter computes EMA9/20 and simple RSI from licensed 1M OHLC aggregated to complete 3M bars. This is independent-data computation, **not** native 3M analysis published by other trading systems. Native third-party analysis is explicitly NOT_CONNECTED; its provider and access agreement are still required.
- Research contexts and tracker records are in memory and reset on process restart. This tracker must not be promoted to production deduplication or execution without durable storage. Existing production alert persistence is unchanged.
- Static spread inputs are estimates, not live broker spreads. Broker/CFD instrument mapping, especially US30, needs verification.
- No staging URL has been provisioned for this change. Live publication is now authorized by the user; verify Render deployment status before claiming success. UI browser rendering still requires visual acceptance on a staging deployment; source and server tests do not substitute for it.

## Verification

Run `npm test`. New tests cover forecast boundaries, all eleven pairs, missing/stale data, entry extension, locked plans, conservative intrabar resolution, minute aggregation, provider-unconfigured behavior, feed authentication, and HTTP session/origin protection. The PostgreSQL integration test requires its dedicated test database and is skipped when absent.

## Promotion sequence

Compile bridge; configure staging integrations; verify desktop/mobile rendering; collect forward observations for each pair; implement durable candidate state; review native external provider requirements; only then explicitly approve merge and live activation. Rollback of code alone does not restore database or VM state.
# Senario scalping 3M dalam panel AI

Panel AI mengambil SOP semasa daripada perkhidmatan prediction dalaman di server,
bukan daripada input browser. Ia hanya menganggap SOP sah apabila masa terima
kurang 90 saat dan masa candle asal tidak lebih 4 minit. Close 1M sumber luaran
mesti benar-benar lengkap dan tidak lebih 90 saat. Jika salah satu sumber tiada,
senario entry kekal menunggu. Ulasan GPT mendapat snapshot SOP yang sama dengan
panel; ia tidak mengawal signal, Telegram atau MT5.

Julat 3 dan 15 minit ialah gandaan ATR 3M daripada 14 candle lengkap, untuk
rujukan volatiliti bersyarat. Gandaan ini belum dikalibrasi menjadi kebarangkalian
atau sasaran keuntungan. Status CHASE menandakan harga telah bergerak jauh dari
entry SOP; ADVERSE menunjukkan pergerakan melawan pelan; DIVERGENT menunjukkan
bias OHLC luaran yang bertentangan. Semua status ialah penerangan, bukan arahan
broker. Spread/tick broker sebenar tetap perlu disemak sebelum sebarang tindakan.
