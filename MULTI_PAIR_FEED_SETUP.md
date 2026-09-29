# ZenCore Multi-Pair Feed 32.4

This Pine bridge sends the nine supported markets on a 3-minute chart. It sends the chart's Entry, initial SL, TP1, TP2, TP3 and selected TP mode to ZenCore. The server preserves those levels for signal and trade plan; it does not calculate replacement targets from the latest close.

## Markets

XAUUSD, EURUSD, GBPUSD, USDJPY, USDCAD, USDCHF, EURJPY, GBPJPY, EURGBP.

## TradingView setup

1. Add `ZenCore_Multi_Pair_Feed_32_3.pine` to a 3-minute TradingView chart.
2. Set **Mod Sasaran TP** to the same option used on the main ZenCore chart: **Fibonacci** or **Fixed R:R**. The default on both scripts is Fixed R:R.
3. Create an alert with condition **Any alert() function call** and webhook `https://zencore-precision-entry.onrender.com/webhook`.
4. Leave the alert message unchanged; the script produces the JSON payload.
5. Confirm the status table reports 3M READY and BATCH ACTIVE.

For a symbol that also has an individual main-chart alert, its main-chart levels and TP mode take precedence on the same candle. The batch feed supplies the remaining symbols.

TradingView keeps a snapshot of the script and inputs in each alert. Delete and recreate an existing alert after updating this script or changing TP mode.
