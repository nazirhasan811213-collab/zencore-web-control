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

This source tree's packaged connector is **2.2.2**, whereas the installed VM
was reported as **2.2.5**. Do not deploy the server change on its own or turn
on execution. First port these worker changes onto the reviewed 2.2.5 source,
issue a new pinned connector artifact, upgrade the Windows slots in connection
only mode, and verify exact ticket/volume/SL behavior on two Demo accounts and
all configured broker symbols. Keep `ZENCORE_AUTOTRADE_EXECUTION_ENABLED=false`
and the manager/slot execution gates locked until that validation passes.

The current worker remains Demo-only, uses the approved InterStellar server and
requires exact broker symbol names. Additional broker servers and suffixes need
their own connection, symbol mapping and account isolation validation before
they can be enabled. The VM slot capacity remains finite and additional users
require more reviewed worker hosts.
