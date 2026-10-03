# Auto Trade strategy and asset settings

Implementation branch: `feature/strategy-pair-settings`. This release publishes the settings; live TF10 execution remains unavailable.

## Client settings

1. Open Auto Trade. Choose **TF2 min — Scalping** or **TF10 min — Long**.
2. Enter account capital (USD).
3. Set Gold lot per layer and number of layers separately from currency lot per layer and layers.
4. Each strategy retains its own Gold/currency settings when switching the selector.
5. TF10 fixes both Gold and currency at exactly two layers. “Long” means a longer entry timeframe; BUY or SELL still follows the SOP.
6. Select execution pairs for the local EA, within the validated broker scope.
7. Confirm risk and save. Before changing strategy, stop new entries and wait for existing positions to finish.

There is no spread-ceiling setting or per-pair spread entry filter. Gold and currency sizing remains separate. Broker spread and slippage still affect actual execution cost.

## What is connected

TF2 command building selects the correct Gold or FX lot/layers. TP/SL remain the precise Analysis/Pine levels; settings do not invent replacement levels. Risk preview uses the selected asset group and broker tick specification.

TF10's offline engine is included, with its earlier SOP and tests. **Its live Analysis feed, dispatcher adapter and management routing are not connected.** The UI can save TF10 preferences, shows the pending status, and disables ON. The API rejects ON with `TF10_FEED_REQUIRED`; the dispatcher rejects TF10 entries. TF2 data cannot be relabelled or used to trade TF10. This is not a live-ready TF10 release.

Existing accounts retain their original lot/layers when first migrated; the TF10 draft starts with the same lot and exactly two layers. Existing database rows need no manual edits. Initialization adds the `execution_settings` JSONB column idempotently. Preferences stay scoped to each account.

## Verification and remaining integration

Focused JavaScript tests cover migration, independent asset sizing, persistence, account isolation, TF10 two-layer enforcement and refusal of wrong-frame entries. Existing Python tests exercise signed local transport. Tests use fake brokers, not live/demo terminal orders.

TF10 still requires dedicated Pine/Analysis feed, dispatcher and timeframe-specific management integration before it can be activated. Publishing these settings does not install an EA or enable trading on the Windows VM.

### Recorded validation

Focused tests verify the settings and existing execution contract. The broader Auto Trade service suite has 21 passing and 3 failures involving old READY fixtures; the same 3 failures were reproduced unchanged on the deployed-base worktree. No real terminal, Pine compiler, database server, installer or broker execution was tested.
