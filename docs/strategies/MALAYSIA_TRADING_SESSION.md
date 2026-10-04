# Malaysia trading session and fixed news pauses

Timezone: Asia/Kuala_Lumpur. Entry is allowed from 07:00 inclusive until 03:00 exclusive the following morning. No new entries from 03:00 until 07:00.

| Requested pause start | No new entries | Resume |
|---|---|---|
| 8:30pm | 20:30–21:00 | 21:00 |
| 9:30pm | 21:30–22:00 | 22:00 remains paused by next window |
| 10:00pm | 22:00–22:30 | 22:30 |
| 2:00am | 02:00–02:30 | 02:30 |

The 21:30 and 22:00 windows join into one 60-minute pause, 21:30–22:30. Each requested pause starts AT the supplied time, rather than 15 minutes before. These are fixed daily windows, not calendar-verified US release times; the implementation does not detect news or change these times for US daylight-saving time.

Pauses block new entries, not position management. Existing SL/TP, StepLock, partial exit, opposite signal exit and emergency close remain available. Positions are not forcibly closed at 03:00. The master ON setting is retained so entries can resume when the next window opens; normal connection/SOP checks still apply.

Implemented as a per-account checkbox and persisted policy in execution_settings. Existing live profiles without this setting remain disabled for backward compatibility. Enabling it in the saved settings applies the same entry schedule to both selectable strategies and all selected pairs. Existing client updates without this field preserve the saved policy. The offline TF10 candidate uses this requested schedule by default. TF10 still requires the separate live feed/adapter integration.

The dispatcher and shared entry command builder reject entries during blocked periods. Entry command expiry is capped at the next pause/session close so stale pending commands cannot begin after that boundary. Position management commands keep their normal lifetime. An already executing market order cannot be cancelled by a server-side time filter; strict per-layer execution checks require the deployed executor to enforce the boundary too.

Tests cover overnight rollover, exact half-open pause boundaries, merged 21:30–22:30 windows, Malaysia conversion from UTC, signed command expiry, per-user persistence and continued position management during pauses.

This is an offline draft. It has not been deployed or enabled in a live user's account. Previous virtual-trade result files predate the session filter and must not be described as results with this schedule applied.
