# ZenCore Secure Pod on a trader-owned Windows PC

This profile connects ZenCore to MetaTrader 5 already installed on the trader's own PC. Release `1.4.0-demo-execution` can execute **XAUUSD on InterStellar Demo only** after both the local and server rollout gates are enabled.

## Security boundary

- Enter the MT5 account ID, password and `InterStellarFinancial-Demo` server only inside the official InterStellar MT5 terminal.
- Never enter broker credentials into ZenCore, PowerShell, JSON, environment variables or support chat.
- ZenCore receives only masked account/server identity, terminal health, broker symbol specifications and ZenCore position snapshots.
- The one-time pairing code expires after 10 minutes. It is not a broker password.
- The resulting pod token and command verification key are encrypted by Windows DPAPI for the Windows user that performs pairing.
- The worker makes outbound HTTPS requests only. No router port-forwarding or inbound web server is required.
- The worker refuses real accounts, any server other than `InterStellarFinancial-Demo`, and every execution symbol except XAUUSD.
- Order execution requires all of: the reviewed worker build, `-EnableDemoExecution`, a signed ZenCore command, the server rollout gate and an explicit **AKTIFKAN DEMO** confirmation.

## PC requirements

- Windows 10/11 64-bit with Secure Boot and TPM 2.0 enabled.
- BitLocker enabled on the Windows system drive.
- Windows Firewall enabled for Domain, Private and Public profiles.
- A password-protected dedicated Windows user. Do not use a shared Windows account.
- InterStellar MT5 logged into the Demo account.
- Official Python 3.12 64-bit with the `py.exe` launcher.
- The PC must remain powered on, connected to the internet and signed into the paired Windows account for continuous monitoring.

## Install

Open Windows PowerShell as Administrator from the extracted release folder:

```powershell
Set-Location '.\mt5-secure-pod'
.\Install-ZenCoreSecurePod.ps1 `
  -HostProfile WINDOWS_PC `
  -EnableDemoExecution `
  -Mt5TerminalPath 'C:\Program Files\InterStellar MT5\terminal64.exe'
```

If InterStellar installs MT5 elsewhere, locate `terminal64.exe` and use that exact path. If a broker symbol has a suffix, provide all 11 mappings through `-SymbolMapJson`; never put the broker login, password or server in that JSON.

## Preflight and pairing

Run every command as the same dedicated Windows user:

```powershell
& 'C:\Program Files\ZenCore Secure Pod\Test-ZenCoreSecurePod.ps1'
& 'C:\Program Files\ZenCore Secure Pod\Pair-ZenCoreSecurePod.ps1'
& 'C:\Program Files\ZenCore Secure Pod\Test-ZenCoreSecurePod.ps1' -RequirePaired
& 'C:\Program Files\ZenCore Secure Pod\Register-ZenCoreSecurePodTask.ps1' -StartNow
```

When the pairing script prompts:

1. Sign in to ZenCore and open `/auto-trade`.
2. Choose **PC WINDOWS SENDIRI**.
3. Generate the one-time pairing code.
4. Paste it only into the hidden PowerShell prompt on the same PC.

Before preflight, open InterStellar MT5, log in to `InterStellarFinancial-Demo`, enable Algo Trading and allow the external Python API. The preflight must report `InterStellar MT5 Demo execution = PASS`.

After pairing and after the server rollout gate is enabled, ZenCore should show `MT5 SECURE POD READY`, a masked Demo identity and a recent heartbeat. Save XAUUSD settings and type **AKTIFKAN DEMO** on the website before the worker accepts a valid Normal 3M SOP V32 setup.

## Demo execution behaviour

- Entry remains Normal 3M SOP V32; this release does not add a manual or test entry that bypasses the SOP.
- Each setup opens the configured layers with the same broker-side initial SL and no broker-side TP close.
- EXIT 32.3 StepLock moves SL to each layer's actual entry at TP1, TP1 at TP2, and TP2 at TP3.
- Close Separuh is executed only once. With 3 × 0.01 and a 0.01 broker lot step, 0.015 cannot be traded, so the worker safely rounds the close to 0.02 and leaves a 0.01 runner.
- STOP immediately disarms new entries while StepLock and exit management continue for existing ZenCore positions.
- An interrupted command is recorded locally before broker execution; a replay is blocked rather than risking a duplicate order.

This is a Demo broker-test release. It must not be used with a real-money MT5 account. Other pairs remain analysis-only until separate broker validation is completed.
