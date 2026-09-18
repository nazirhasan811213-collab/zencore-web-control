# ZenCore Secure Pod on a trader-owned Windows PC

This profile connects ZenCore to MetaTrader 5 already installed on the trader's own PC. It is intended for the InterStellar **DEMO connection and monitoring rollout**. Order execution remains locked in this release.

## Security boundary

- Enter the MT5 account ID, password and `InterStellarFinancial-Demo` server only inside the official InterStellar MT5 terminal.
- Never enter broker credentials into ZenCore, PowerShell, JSON, environment variables or support chat.
- ZenCore receives only masked account/server identity, terminal health, broker symbol specifications and ZenCore position snapshots.
- The one-time pairing code expires after 10 minutes. It is not a broker password.
- The resulting pod token and command verification key are encrypted by Windows DPAPI for the Windows user that performs pairing.
- The worker makes outbound HTTPS requests only. No router port-forwarding or inbound web server is required.
- The worker refuses real accounts and this build reports `demoExecutionUnlocked=false`, so the website cannot turn Auto Trade on.

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

After pairing, ZenCore should show `CONNECTED • EXECUTION LOCKED`, the masked InterStellar Demo identity and a recent heartbeat. That is the expected successful state for this release.

## What this release cannot do

- It cannot place, modify or close an MT5 order.
- The website ON button remains disabled because the worker reports execution locked.
- Changing `pod-config.json` cannot bypass the lock; the Python build contains a second immutable `DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = False` gate.

Order execution will be unlocked only in a separately reviewed Demo broker-test release after symbol mapping, three-layer entry, partial close, StepLock, restart, replay and disconnection tests pass.

