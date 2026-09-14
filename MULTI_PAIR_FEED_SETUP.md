# ZenCore Multi-Pair Feed 32.3

This bridge feeds all 11 supported instruments to ZenCore Web Control from one TradingView alert.

## Markets

XAUUSD, EURUSD, GBPUSD, USDJPY, US30, USDCAD, USDCHF, EURJPY, GBPJPY, EURGBP, BTCUSD.

TradingView mappings use OANDA symbols. US30 is mapped to OANDA:US30USD.

## One-time TradingView setup

1. Open any TradingView chart and set the chart timeframe to 3 minutes.
2. Add the Pine file ZenCore_Multi_Pair_Feed_32_3.pine to Pine Editor and save it.
3. Add the script to the chart.
4. Create one alert.
5. Condition: ZenCore Multi-Pair Feed 32.3.
6. Trigger: Any alert() function call.
7. Webhook URL: https://zencore-precision-entry.onrender.com/webhook
8. Leave the alert message box unchanged because the Pine script generates the batch JSON.
9. Confirm that the script status table shows 3M READY and BATCH ACTIVE.
10. Once the new feed is visible on the website, the previous single-pair webhook alert can be removed.

After this one-time setup, traders can switch instruments from LIVE MARKET without changing the TradingView alert.

## Behaviour preserved

- Normal Scalping 3M hard-gate structure.
- Five SOP checks and current 5M HEMA confirmation.
- Close 50% advisory, followed by confirmed opposite yellow candle for the remaining 50%.
- TP1 moves SL to entry.
- TP2 moves SL to TP1.
- TP3 moves SL to TP2.
- Existing single-symbol webhook payloads remain accepted by the server.

TradingView alerts are snapshots. Recreate the alert only when this Pine feed script or its inputs are changed.
