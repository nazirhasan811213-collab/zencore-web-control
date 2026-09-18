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
| 2 | Full Page Utama / 11-market radar navigation | Implemented on `codex/market-radar-home-v1`; not deployed |
| 3 | Result Page and 11-market signal validation history | Implemented on `codex/result-page-v1`; not deployed |
| 4 | End-to-end validation and operational controls | In progress; Auto Trade contract tests added |
| 5 | MT5 Total Trade System | DEMO control plane + Secure Pod worker foundation implemented; not deployed |

## Locked analysis constraints

- Normal 3M SOP V32 remains the entry engine.
- EXIT 32.3 StepLock remains unchanged.
- The 11-market Pine feed and pair selector remain unchanged.
- Auto Trade is feature-flagged OFF by default. It does not change the Analysis entry or exit engine.
- ZenCore quality scores are not presented as guaranteed win rates.
- Market Radar ranks and filters the existing `strategyNormal` state; it does not generate a new signal.
- Result Page reads the existing Normal validation engine; it does not calculate broker P/L or change an outcome.
- Current signal history is held in server memory and can reset when the service restarts.

## Locked Auto Trade decisions

- ZenCore cloud performs the complete analysis-to-MT5 flow; the trader's PC is not required after secure enrolment.
- Broker ID, password and full server must never enter the Render control plane, PostgreSQL or application logs.
- ON becomes effective only after Secure Pod acknowledgement.
- STOP blocks new entries while EXIT 32.3 continues managing open positions.
- Emergency Close All is separate and requires step-up authentication plus an exact confirmation phrase.
- High risk is a warning only after trader acknowledgement; technical and security failures may block execution.
- First rollout is InterStellar DEMO and must remain execution-locked until confidential Windows/HSM infrastructure is verified.

Stable restore point before Phase 1: `backup-stable-20260917` at commit `bd99019`.
