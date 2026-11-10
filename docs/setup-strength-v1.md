# Pine Technical Strength V1

Analysis only: no execution gates, position sizing, entry, re-entry or exit rules change. This score is not a win probability. Existing Pine payloads supply the inputs; no client installer or Pine update is required.

Every entry/re-entry event captures a JSON snapshot (model version, timestamps, TF, side, plan, raw inputs, group contributions, warnings, target scores and indicator range). Persisted records clone the snapshot. Old signals remain unscored. The dashboard computes a separate current assessment. Missing/invalid/stale data yields no percentage and Telegram names the missing inputs.

| Group | Weight | Contribution |
|---|---:|---|
| HEMA | 15 | Fast/slow in trade direction |
| EMA | 10 | Half each for 9/20 and 20/50 alignment |
| WT | 15 | WT1/WT2 in trade direction |
| RSI | 10 | Full for BUY 50–70 / SELL 30–50; quarter beyond directional extreme |
| Candle | 10 | Same direction: half plus half body/range; opposite/doji zero |
| Chop | 10 | Linear 65→0 to 40→full |
| Relative volume | 5 | Volume / 1.2 capped at full |
| MTF | 10 | Signed score -3→zero, 0→half, +3→full |
| Forecast | 15 | Aligned: reported power /100; neutral half; opposed zero |

Opposing forecast, strongly opposing MTF (signed score ≤ -2), or Chop ≥60 caps the overall score at55. SOLID is a prerequisite; Pine probability/confluence/advisor text are not additional independent evidence. All numerical cutoffs and weights are design heuristics, not fitted or validated outcome statistics.

TP strength = overall minus15 points per ATR distance beyond0.5 ATR, minus10 if beyond the nearest confirmed directional structure. Floor zero. Further targets cannot score higher. These scores describe technical support, not per-target hit probability.

Indicator envelope starts at the signal entry, reaches ATR × (0.5 + overall/100), capped at TP3 and the nearest confirmed directional structure. Display band spans75–100% of that distance. TF2 horizon30min; TF15 60min. Structure uses only closed as-of candles via the existing nearby-level helper, capped at min(2ATR,USD3.50) for TF2 /3ATR for TF15. Without structure the snapshot explicitly records ATR-only coverage. This envelope is not a maximum reachable price or statistical confidence interval.

Historical evaluation: `/api/signal-records` returns `strengthEvaluation` for the latest500 retained signals, separately by TF and score bands. It counts observed TP events, excluding unscored old records. Open/missing outcomes are not failures; counts do not establish TP-before-SL, broker fills or win rate. Two-month retention remains unchanged. Reliable calibration requires complete future price/exit observations and sufficient out-of-sample results.
