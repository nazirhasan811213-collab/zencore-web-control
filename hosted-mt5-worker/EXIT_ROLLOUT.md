# Multi-account MT5 exit rollout

The control plane fans one validated Analysis decision to opted-in accounts with
open positions. Hosted management commands now carry the broker tickets reported
by that account's last worker heartbeat. The worker only modifies those ZenCore
positions. STOP disables new entries but does not disable position management.

Exit behavior follows the existing `32.3-EXIT-STEPLOCK` Analysis contract:

* `CLOSE_50_NOW`: close half the aggregate volume across the account's position
  layers, rounded down to the broker's volume step. A 3 × 0.01 campaign with a
  0.01 step closes one 0.01 layer. An unrepresentable partial is rejected.
* `MOVE_SL_ENTRY`, `MOVE_SL_TP1`, `MOVE_SL_TP2`: accept the Analysis stop only if
  it improves the live stop for the position's side. Check the broker state
  before acknowledging.
* `EXIT_REMAINING`, `EXIT_ALL`, `EXIT_SL`: close the remaining targeted tickets;
  acknowledge only after the broker reports they have disappeared.
* `EMERGENCY_CLOSE_ALL`: close ZenCore magic-number positions in that slot and
  confirm the broker has no remaining ZenCore positions.

The exit ledger resides in each slot's `worker/exit-ledger.json`. It records a
partial as `IN_FLIGHT` before contacting the broker and `DONE` only after the
volume drops by the target amount. An interrupted or uncertain partial stays
blocked with `PARTIAL_CLOSE_RECONCILIATION_REQUIRED`; an operator must inspect
the broker positions before recovery. Never delete that ledger while the slot
has an open position. A new, disjoint set of broker tickets starts a new
campaign. Commands for tickets that have already closed cannot affect later
positions in the same pair.

The source now identifies as **2.2.6**, whereas the installed VM was reported
as **2.2.5**. The 2.2.5 executable sources were not present in this repository;
the new source includes its documented portable slot behavior. GitHub Actions
built a Windows 2.2.6 artifact, but it has not been installed or compared with
the broker on the VM. Do not deploy the server change on its own or turn on
execution. Verify the pinned artifact checksum and upgrade script,
upgrade the Windows slots in connection-only mode, and verify exact
ticket/volume/SL behavior on two Demo accounts and all offered broker symbols.
Keep `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false` and the manager/slot execution
gates locked until that validation passes.

Run `Test-ZenCore-2.2.6-Preflight.ps1` from the extracted release after the
connection-only upgrade. Its process and slot checks report only sanitized
status. A successful local preflight does not establish broker connectivity:
verify each account's fresh `CONNECTED_LOCKED` heartbeat and broker symbols in
ZenCore separately. The script defaults to three expected slots; set
`-ExpectedSlots` to the number of assigned accounts on the VM.

The source remains Demo-only. `ENVELOPE` server mode accepts the server in the
user's encrypted credential and verifies the connected account's server and
DEMO trade mode. Exact broker symbol names take priority; one unique suffix
variant can be mapped to a ZenCore pair. Ambiguous aliases and unsupported
symbols do not execute. Test each broker's symbol set before rollout. The VM
slot capacity remains finite and additional users require more worker hosts.
