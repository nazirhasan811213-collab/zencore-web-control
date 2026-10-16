# ZenCore TF3 — ATR14 / ribbon / close all

Release scope: application, Pine feed, dispatcher, Telegram, monitoring and web configuration only. Connector and EA source/binaries unchanged.

## Active scalping policy
- TF3; ATR(14); MTF 5/10/15.
- SOLID from native chart; held until opposite live HEMA ribbon or native Close All.
- Mandatory matching HEMA20/40 ribbon colour. HEMA40 slope is not a separate mandatory gate; both slopes count together as one of six confirmations.
- Minimum 4/6 current confirmations: price vs original entry, WT, both HEMA slopes, checklist >=3/5, forecast thresholds 45, directional MTF.
- SL 0.65 ATR(14) from SOP-completion entry, rounded outward to the symbol tick. No three-candle structure gate or 0.75 ATR rejection.
- TP1 min(0.5 ATR,3), TP2 1 ATR, TP3 1.5 ATR.
- TP1 lock entry +/-0.50 (price units), TP2 lock TP1, TP3 lock TP2.
- Native chart Close Separuh now means CLOSE ALL for the matching TF3 setup.
- ATR/entry anchor fixed at SOP completion, not broker fill. Existing EA supports exact supplied SL.
- Fresh EXECUTION entryEvent=true within 30 seconds remains mandatory; Dashboard cannot authorize an order. TF3 server no longer adds an SL-to-TP1 price-range gate. Broker/unchanged EA execution checks still apply.
- No automatic TF2/TF3 switching. No profit claims or native Pine compilation verification.

## Compatibility
TF3 orders reuse the existing TF2_SCALPING transport mode/magic and existing lot/layer settings. Payload executionTimeframe remains 3. No TF2 three-candle legacy exit policy is attached. ENTRY_PLUS_050 maps on server to existing absolute-price MOVE_SL_TP1 command, with activeSl carrying the exact lock level. Old TF2 entries are disabled by the application setting; old position management remains available and is isolated from TF3 by setup identity. Manual-entry exit policy remains unchanged.

## TradingView activation after deployment
1. Stop the old TF2 Dashboard/Execution entry alerts; keep management for any old TF2 position until it closes.
2. Open XAUUSD on 3 minutes, standard candles, Scalping, Fixed R:R.
3. Replace the scalping indicator with ZenCore_TF3_Scalp.pine. Existing chart plan remains the native SOLID source; SOP80 Entry and SL/TP plots are the execution plan.
4. Set the existing webhook secret privately; never share it in screenshots.
5. Create Dashboard and Execution alerts using the two feed-channel settings and Any alert() function call, with the existing ZenCore webhook URL. Each alert captures its own indicator settings.
6. Verify TF3_DASHBOARD and TF3_EXECUTION in admin monitoring, fresh timestamps, correct rule TF3_SOLID_RIBBON_V1 and ATR period 14.
7. Existing accounts retain their ON/OFF status, broker login, lot/layers and real/demo authorization. No force orders are submitted during deployment.

## Rollback
Restore the previous application commit and its TF2 Pine alerts together. Do not mix TF3 and TF2 execution setups. Preserve open positions and broker-side SL.

## Dual timeframe release — 16 October 2026
TF15 now follows the same held-SOLID, mandatory ribbon, any 4/6 confirmations and ATR14 plan as TF3. Its own HEMA15 values and MTF 15/30/45 are mandatory data; it does not reuse TF3 candles. The risk multipliers, TP1 price cap and exit rules are identical, measured with each timeframe's ATR14. New Pine: ZenCore_TF15_Intraday.pine. Choose Intraday, 15 minutes, Unified alert. TF3 remains Scalping, 3 minutes, MTF 5/10/15.

Connector 2.1.0 embeds EA 2.10 source, adds explicit TF3/TF15 mode validation and clearer rejection codes, and retains broker-price and account protection checks. EA EX5 is compiled locally by Connector with MetaEditor. The installer does not link accounts, arm trading or send orders.

## Pine primary policy — 17 October 2026
Supersedes the earlier ATR scalp caps and 4/6 sections above for new entries.
The supplied Pasted text(10).txt is the reference: native SOLID label, Movement = WT1 > WT2 ? Bullish : Bearish, HEMA Trend = HEMA20/40 ribbon. All three are mandatory. Five current confirmations: price vs source SOLID, WT, native checklist >=4/5, forecast 45 thresholds, directional MTF. Any four pass. No slope gate. Native checklist item 5 is HTF HEMA (TF3 -> 5, TF15 -> 30), separate from MTF score.

At SOP completion freeze entry and ATR14. SL = entry +/-1 ATR. Honour Pine TP mode: Fixed R:R 1/2/3, or Fibonacci ratios 1.618/2.618/4.236 measured from SL. Fibo box ratios .236/.786 remain native. No extra ATR caps. The native virtual-position waiting veto and EA SL-to-TP1 entry-price veto are removed. Existing same-strategy positions, broker SL-distance and account permissions remain execution guards.

New setups carry PINE_3TRIGGERS_4OF5_V2 and PINE_STEPLOCK_150_TP3_PLUS3_V1. TP1 lock is Pine entry +/-1.50, TP2 locks TP1, TP3 locks TP2; quote strictly more than 3.00 past TP3 locks TP3. A lock cannot be installed before price/broker distance permits it. Native Close Separuh and Close All both close all for that setup. Existing older positions retain their stored exit version.

A complete connected MT5 snapshot transitioning a strategy from positions to zero persists a per-pod/mode reset in the audit store. Only a native SOLID triggered after that reset may authorize a fresh setup. Partial/manual closes and the other timeframe do not reset it. Current-policy new setups bypass the legacy five-minute recent-command cooldown, with setup dedup and live-position guards retained.

Connector 2.1.1 / EA 2.11. Telegram lists each core fact once, replaces low-quality/no-trade advice with SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT, and omits repeated AI Coach trend/momentum/advice. No messages or forced broker orders are sent as tests.
