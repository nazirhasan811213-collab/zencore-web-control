# Signal Outcome Audit · Normal 3M

Read-only collector calls the existing V17 validation summary for each of eleven pairs every 15 seconds. Completed Normal 3M records are inserted by stable source signal ID into PostgreSQL. It does not mutate the V17 engine, TradingView SOP, Telegram, or MT5.

The authenticated `/api/signal-outcomes` endpoint returns persisted records (latest 100) and counts per pair. The Result page separates this archive from the live in-memory summary. The archive survives a web process restart, but is **not** broker P/L, does not backfill records older than the twenty recent outcomes in each V17 snapshot at first activation, and cannot reconstruct open signals or records missed while the service is offline. An interrupted sync reports partial status. Compare histories with actual MT5 fills, bid/ask, spread, commission and slippage before calculating net returns.

The Analysis page additionally labels the current 1M close as near entry, chase, adverse or unavailable and shows directional distance to entry. It is not a broker tick. The existing signal decision and execution contract remain unchanged.
