# ZenCore MT5 Secure Pod — DEMO foundation

This worker runs beside MetaTrader 5 inside an isolated Windows confidential VM **owned by the trader's Azure subscription**. It is not deployed on Render and it does not accept broker credentials from the ZenCore control plane.

## Security boundary

- The trader owns the Azure subscription, Windows administrator access and VM encryption keys. ZenCore administrators receive none of them.
- The MT5 terminal must be enrolled directly inside the trader-owned Secure Pod.
- Broker login, password and full server never appear in the control-plane API, PostgreSQL, logs, command payloads or environment variables.
- The control plane receives masked identity only.
- The browser creates a random, single-use pairing code that expires after 10 minutes. It is not a broker credential.
- Pairing returns a pod token and a **per-pod** command verification key directly to the worker. They are encrypted with Windows user-scope DPAPI in `machine-credentials.dpapi` and are never returned to the browser. The scheduled worker must run under the same dedicated Windows account that performed pairing and owns the MT5 terminal session.
- This release pins the control origin to `https://zencore-precision-entry.onrender.com`, ignores process proxy settings and rejects HTTP redirects, preventing config-only redirection of pairing material or pod authorization.
- A compromised pod cannot derive the control-plane master key or another trader's per-pod key.
- The worker refuses non-DEMO accounts.
- Command IDs are stored in a local SQLite ledger so a retry cannot place the same setup twice.
- The worker starts fail-closed. This release requires both a later reviewed build unlock and an explicit local config change before even DEMO order execution can run.

## Install on the trader-owned VM

Use the reviewed deployment and Windows setup runbook in `infra/azure-trader-pod/README.md`. The automated installer writes only a non-secret config, creates a pinned Python environment and keeps `demoExecutionEnabled=false`.

## One-time pairing

1. The signed-in trader opens `/auto-trade`, selects **JANA KOD PAIRING**, and types `PAIR SECURE POD`.
2. Inside the trader-owned Windows confidential VM, run `Pair-ZenCoreSecurePod.ps1` as the dedicated worker user.
3. Python reads the short-lived code with hidden console input, exchanges it directly over HTTPS and protects its pod identity with Windows user-scope DPAPI. The code is never put in command arguments or environment variables.
4. The full MT5 login, password and server are entered only into the MT5 terminal inside that VM.

## Non-secret local config

```json
{
  "schemaVersion": 1,
  "controlUrl": "https://zencore-precision-entry.onrender.com",
  "mt5TerminalPath": "C:\\Program Files\\InterStellar MT5\\terminal64.exe",
  "symbolMap": { "XAUUSD": "XAUUSD" },
  "pollSeconds": 2,
  "demoExecutionEnabled": false,
  "dataRoot": "C:\\ProgramData\\ZenCoreSecurePod"
}
```

The installer creates a full 11-market map. The shortened map above only illustrates the field shape. Broker login, password and full server are not valid config fields. Subsequent starts load the DPAPI-protected pod identity from `%PROGRAMDATA%\ZenCoreSecurePod\machine-credentials.dpapi`.

`demoExecutionEnabled` must remain `false` until the isolated Windows pod, broker symbol mapping, three-layer behavior and InterStellar demo account have passed an execution test. This release also compiles in `DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = False`, so changing config or environment alone cannot place an order.

## Command behavior

| Command | Worker behavior |
|---|---|
| `SYSTEM_ON` | Verify DEMO terminal and arm new entries |
| `SYSTEM_STOP` | Block new entries; keep position management running |
| `PLACE_SETUP` | Place configured layers only when DEMO execution is explicitly unlocked; TP1/2/3 remain StepLock milestones |
| `MANAGE_POSITION` | Apply StepLock SL move, Close Separuh or remaining exit |
| `EMERGENCY_CLOSE_ALL` | Disarm and close all ZenCore positions |

All layers use the same initial SL and no broker-side TP close. TP1, TP2 and TP3 are protected-price milestones: SL moves to Entry, TP1 and TP2 respectively. Close Separuh and confirmed opposite-yellow commands retain the previously locked exit SOP. The local worker also advances these StepLock levels from live MT5 price if the control-plane connection is temporarily unavailable.
