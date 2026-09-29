# Peta sasaran Normal 3M — Pine sahaja

The signed-in Analysis page reads the fresh V17 Normal SOP plan and indicator inputs from the same confirmed 3M multi-pair Pine feed. No new Pine alert, market data collector, GPT call or historical outcomes are needed. Existing Entry/SL/TP1–3, signal gates, Telegram and MT5 execution are unchanged.

The V17 strategy SOP now exposes EMA 9/20/50, HEMA 20/40, WaveTrend 1/2, RSI, chop index, relative volume, MTF global trend and basis already sent by the Pine bridge. The target map checks trend, EMA alignment, HEMA alignment, WaveTrend, RSI room, chop, Pine forecast, power/SOP and volume when available. It compares directional distance from the confirmed 3M close to each existing TP with a 1.5 ATR heuristic envelope, capped at a closer EMA20 or HEMA20 opposing level. Every TP is labeled supported, limited, blocked, outside envelope or already passed. Labels are deterministic, uncalibrated technical assessments, not TP probabilities or guaranteed price moves.

No outcome archive is queried by this feature. If any required indicator value or fresh confirmed SOP is missing, the map shows only the existing plan distances or waits. FX distances use 0.0001 pips or 0.01 for JPY. Gold is USD/oz and BTCUSD is USD. Monetary P/L requires the broker's actual tick and lot specifications plus costs.
