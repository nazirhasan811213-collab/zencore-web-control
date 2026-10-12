# Chart / SOP parity candidate — 12 October 2026

Status: candidate source only. Not Pine-compiled, not enabled on client accounts. No Connector, EA, live profile or trading setting changes.

## Corrected interpretation
The original chart's Solid Entry label is an early trigger, not proof that the server execution SOP passed. Its checklist row 1 describes WaveTrend direction; row 2 checks the basis rather than the entry line. The original chart default Gold TF2 plan uses 0.65 ATR; canonical real-time bridges use 1.0 ATR. HEMA3 in the original legacy payload uses a closed bar and HEMA23_V1; the restored SOP expects HEMA23_LIVE_V1. These are different snapshots/logic, not evidence of a connector direction reversal.

## Generated aligned chart
- Use ZenCore_Chart_TF2_SOP_Aligned.pine or ZenCore_Chart_TF15_SOP_Aligned.pine after compilation.
- Canonical scan function, targets, latch, pullback and eligibility are copied from the corresponding real-time feed. Generate with node scripts/build-sop-chart.cjs; do not edit generated charts separately.
- OANDA:XAUUSD and matching TF are required, so plotted levels belong to the visible market provider.
- Separate SOLID trigger from SOP READY. Table displays held SOLID, price-past-entry, 4/5 checklist, forecast, own/higher HEMA, 40% pullback, entry window and expiry.
- Default plan ATR is 1.0, matching the bridges. Match TP mode and any input overrides on all chart/alert instances. TradingView stores old script/settings in existing alerts; updating source alone does not update an existing alert.
- Feed bounds reject power outside 0–100; TF2 excludes CHOP >=61.8, matching the server execution contract.
- Plot original SL plan and the existing EA's estimated initial 80% SL separately. EA code is untouched. This estimate is not the broker's actual SL after fills, rounding, freeze/stops or StepLock.
- Web feed defaults OFF. With existing live bridges, keep it OFF: the new chart is a visual companion. Do not create duplicate execution alerts or reset a live alert to pick up a historical setup.
- If replacing a bridge with this chart after verification, keep only one Execution source per TF and existing Dashboard channel. Respect the existing bootstrap suppression of historical entry.
- SOP READY shows chart entry gates; actual execution additionally requires fresh authorized events, ON, valid lot/layers/session, connection/permissions and broker acceptance. It does not guarantee an order.

## Profit research candidate (not active)
TF2 candidate TF2_DIRECTION65_SLOPE_EARLY035_RESEARCH_V1 retains the current baseline SOP and adds:
1. Directional forecast: BUY BULLISH / SELL BEARISH >=65%, no NEUTRAL.
2. Own HEMA20 and HEMA40 each slope in entry direction, with ribbon alignment.
3. Current price beyond entry but no more than 0.35 ATR from entry.

candidate-entry-filter.js is research-only and has no production imports. It does not wait another candle. TF15 remains unchanged; no candidate met the predeclared evidence threshold.

On the old August dataset, exploratory TF2 full-month P/L after assumed costs was +USD18.87 to +USD55.07 across two M1 paths, from 5 trades. Only 2 trades occurred in the early selection segment; the minimum was 15. No candidate was selected for rollout. Historical data had already been used in past research; this is not independent validation.

## Before activation
Compile both charts in TradingView. Compare same provider, timeframe, input, timestamp, SOLID latch, entry/SL/TP, HEMA and forecast against the web snapshot. Collect actual BID/ASK tick and Pine event replay on a new period and enough trades; reproduce execution and missed/rejected orders. Keep existing client setup until this check passes.
