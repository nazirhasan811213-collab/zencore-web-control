# ZenCore Product Roadmap

Master user flow:

```text
Login -> Page Utama -> Analysis -> Result
   |         ^            |
   -> Register             -> Optional Auto Trade -> MT5 -> Result
```

Login failure stays on the Login Page with a generic error. Register is a deliberate user choice for someone who does not yet have an account.

## Delivery phases

| Phase | Module | Status |
|---|---|---|
| 0 | Analysis Page | Complete and protected from unrelated changes |
| 1 | Login, Register, secure session and basic Page Utama shell | Implemented on `codex/auth-foundation-v1`; not deployed |
| 2 | Full Page Utama / 11-market radar navigation | Next |
| 3 | User-specific Result Page and signal history | Planned |
| 4 | End-to-end validation and operational controls | Planned |
| 5 | Optional MT5 Auto Trade connector | Parked for a new approved design |

## Locked analysis constraints

- Normal 3M SOP V32 remains the entry engine.
- EXIT 32.3 StepLock remains unchanged.
- The 11-market Pine feed and pair selector remain unchanged.
- Auto Trade is OFF and is not part of the Phase 1 account system.
- ZenCore quality scores are not presented as guaranteed win rates.

Stable restore point before Phase 1: `backup-stable-20260917` at commit `bd99019`.
