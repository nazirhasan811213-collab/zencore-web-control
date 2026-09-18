# ZenCore MT5 Secure Pod — DEMO foundation

This worker runs beside MetaTrader 5 inside an isolated Windows confidential VM. It is not deployed on Render and it does not accept broker credentials from the ZenCore control plane.

## Security boundary

- The MT5 terminal must be enrolled directly inside the Secure Pod.
- Broker login, password and full server never appear in the control-plane API, PostgreSQL, logs, command payloads or environment variables.
- The control plane receives masked identity only.
- `ZENCORE_POD_TOKEN` and `ZENCORE_COMMAND_SIGNING_KEY` are ZenCore machine credentials, not broker credentials. In production they must be injected from the VM's attested secret store/vTPM rather than stored in source or a plaintext service file.
- The worker refuses non-DEMO accounts.
- Command IDs are stored in a local SQLite ledger so a retry cannot place the same setup twice.
- The worker starts fail-closed. Real order execution also requires `ZENCORE_DEMO_EXECUTION=true`.

## Required runtime values

```text
ZENCORE_CONTROL_URL=https://zencore-precision-entry.onrender.com
ZENCORE_POD_TOKEN=<one-time provisioned pod token>
ZENCORE_COMMAND_SIGNING_KEY=<attested machine secret, minimum 32 bytes>
MT5_TERMINAL_PATH=C:\Program Files\InterStellar MT5\terminal64.exe
ZENCORE_SYMBOL_MAP_JSON={"XAUUSD":"XAUUSD"}
ZENCORE_DEMO_EXECUTION=false
```

`ZENCORE_DEMO_EXECUTION` must remain `false` until the isolated Windows pod, broker symbol mapping, three-layer behavior and InterStellar demo account have passed an execution test.

## Command behavior

| Command | Worker behavior |
|---|---|
| `SYSTEM_ON` | Verify DEMO terminal and arm new entries |
| `SYSTEM_STOP` | Block new entries; keep position management running |
| `PLACE_SETUP` | Place configured layers only when DEMO execution is explicitly unlocked; TP1/2/3 remain StepLock milestones |
| `MANAGE_POSITION` | Apply StepLock SL move, Close Separuh or remaining exit |
| `EMERGENCY_CLOSE_ALL` | Disarm and close all ZenCore positions |

All layers use the same initial SL and no broker-side TP close. TP1, TP2 and TP3 are protected-price milestones: SL moves to Entry, TP1 and TP2 respectively. Close Separuh and confirmed opposite-yellow commands retain the previously locked exit SOP. The local worker also advances these StepLock levels from live MT5 price if the control-plane connection is temporarily unavailable.
