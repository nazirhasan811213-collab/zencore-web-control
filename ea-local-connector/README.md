# ZenCore Connect 2.0 / EA 2.00

A shared Windows package for REAL and DEMO clients. Each user pairs to their own
ZenCore login and exact MT5 account/server/mode. It does not contain client keys
or broker passwords. Wire protocol stays 1.4.0-ea-local for backend compatibility;
Connector build and EA version are independent (2.0.0 and 2.00).

## Design

The desktop shows three separate states: terminal, cloud, and entry permission.
Installation, pairing and account reset are separate actions. X minimizes rather
than stopping the process. UI updates use a main-thread queue. Reset invalidates
the local lease immediately and calls the authenticated web reset; failed reset
is shown explicitly and never reported successful.

A signed command is verified against the pod, full account fingerprint, strategy,
EA session and deadline. The Connector forwards pending results before requiring
a fresh EA heartbeat, preserves unacknowledged results on network loss, and never
replays ambiguous entry. Cloud failures invalidate leases and use bounded retry.
An old EA cannot receive V2 ON/entry commands. Management remains available.

## Execution

Analysis owns direction and prices. Default SL is unchanged from its plan;
only an explicitly signed TF2_TIGHT_SL_3C_V1 preset uses 80% initial distance.
EA startup/account switch starts disarmed. OnTick plus timer protection observes
TP1/2/3 and persists the highest stage per position identifier. Broker modifications
never loosen an accepted SL. If a recorded level was crossed while a broker
modification was pending, only that owned position is closed. Protection requests
retry at most twice per second per tracked position. MT5 tick events can coalesce;
no zero-delay or guaranteed-price promise is made.

TP1 moves SL to actual fill entry, TP2 to TP1, TP3 to TP2. There is no broker TP3
close-all. Broker SL survives PC/network failure; local StepLock needs MT5 running
and permissions. Indicator partial/yellow exits still require live Analysis data.
Manual exit remains explicitly opt-in and separate.

## Build and rollout

Use build-windows.ps1 with Python 3.12, PyInstaller and Inno Setup 6. CI tests
transport, DPAPI, the real Tk window, packaged EXE, install and uninstall. The
installer ships MQ5; the selected terminal's MetaEditor compiles it, rejecting
stale EX5. CI packaging alone does not certify MQ5 or broker execution.

Follow PANDUAN_INSTALL_2.0.0.txt. Pause entry, update, compile, reload EA on one
XAUUSD chart, verify exact account and test DEMO before production rollout.
Global entry/signal pause is preserved. No account is activated by installation.
