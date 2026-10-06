# TradingView transport V2

XAUUSD only. Existing entry SOP, HEMA confirmations, risk settings and Pine exit decisions remain unchanged.

## Install in TradingView

Replace both realtime feed scripts with the new sources and compile them in Pine Editor. Source is not considered validated until TradingView compiles it. Create four alert snapshots, all using the existing ZenCore webhook URL and `Any alert() function call`:

1. TF2 script on a 2-minute chart, Alert channel = Execution; name `ZenCore XAUUSD TF2 Execution V2`.
2. Same TF2 script, Alert channel = Dashboard; create a separate alert named `ZenCore XAUUSD TF2 Dashboard V2`.
3. TF15 script on a 15-minute chart, Alert channel = Execution; name `ZenCore XAUUSD TF15 Execution V2`.
4. Same TF15 script, Alert channel = Dashboard; create a separate alert named `ZenCore XAUUSD TF15 Dashboard V2`.

TradingView copies the script and input settings when creating each alert. Changing the chart input later does not change an existing alert. Remove/disable the superseded webhook alerts after the replacements have compiled and been configured, to avoid conflicting feeds. Visual chart alerts can remain if they do not feed execution.

## Behavior

Execution alerts emit a newly eligible setup once, plus changes in position-management state. First realtime tick consumes the currently reconstructed setup without opening it: restarting an alert is not permission to replay an old trade. A genuinely new setup can subsequently enter when the existing SOP passes. The persistent server dedupe key also prevents the same setup becoming a second command.

Dashboard snapshots run at most every 30 seconds on market ticks, capped at 6 sends in a rolling three-minute window. Dashboard messages cannot authorize entry. Execution is independently capped at 12 sends in the same rolling window, not reset on a candle boundary. If exhausted, entry waits for available capacity and must still qualify at the time of sending; it is not guaranteed zero delay under arbitrarily frequent events. There is no TradingView uptime guarantee or bypass of its alert limits.

The server requires a new entry event, rejects stale/future authorization timestamps for V2, rechecks matching TF direction/setup before delivering an order, and revokes pending readiness after changed confirmations. TF2 and TF15 remain isolated. Telegram uses the same authorization contract.

## Position protection

Broker-side SL is already attached by the executor at entry; a cloud or TradingView outage does not remove it. New `ZenCoreExecutor.mq5` version 1.22 adds local StepLock for setups opened with this version: TP1 moves SL to actual fill entry, TP2 to chart TP1, TP3 to chart TP2. It never moves SL backwards or touches positions belonging to other EAs. The saved chart targets persist across EA restarts.

Compile and install 1.22 in MetaEditor before claiming this feature active. Existing setups without its saved target file continue to rely on their broker SL and existing cloud management. Local StepLock needs MT5 online and broker permissions; it does not reproduce Pine's forecast-dependent partial/yellow exits. Broker stop/freeze constraints can delay modifications, which are retried while the target is currently valid. No installer executable was rebuilt in this change.

## Validation

79 scoped Node tests pass, including fresh event/old snapshot separation, direction revocation during async dispatch, delivery-time rejection and TF isolation. Eight legacy auto-trade-service tests fail both on the pre-change baseline and the new source; their older connector/hosted assumptions are outside current EA rollout. Pine and MQL compilation, four live alert instances, and Windows EA execution remain installation verification steps.
