# Analysis notifications

Popup and sound default to enabled per authenticated user. Telegram defaults off.
Signals come from the existing Analysis contract on each accepted feed update,
not browser-side trading rules or MT5 fills. Entry: READY with complete plan.
Close: CLOSE_50_NOW, EXIT_REMAINING, EXIT_ALL and EXIT_SL. Repeated unchanged
states are suppressed. A new setup after a non-ready state can notify again.
All canonical Analysis pairs are included. Feed older than 180 seconds is ignored.

Preferences, transition states, events and Telegram delivery claims persist in
PostgreSQL using the existing auth pool. Browser polling starts at the current
cursor to avoid replaying past signals when opening Analysis. During an open
session, events are paginated and recovered after transient network failures;
alerts older than three minutes are not presented as current. Supported browsers
use Web Locks plus local storage to suppress popup/audio duplicates across tabs.
Browser sound requires an initial user gesture; the UI provides an enable/test
button. Popups require the page to remain open.

## Telegram configuration

Set server-only ZENCORE_TELEGRAM_BOT_TOKEN and
ZENCORE_TELEGRAM_BOT_USERNAME for the ZenCore bot. Never place a token in browser
assets. Without a token, the interface explicitly shows Telegram unavailable;
popup and sound remain usable. Users enter their numeric private Telegram ID,
press Start on the bot, request a 10-minute verification code, verify it, then
opt in and save. Code requests have a 60-second cooldown and five attempts.
Changing ID invalidates verification. Viewers cannot mutate settings.

The server sends opted-in alerts even when the browser is closed. Each delivery
is claimed once before a bounded HTTPS call. Failed/ambiguous sends are recorded
as failed and are not automatically retried, to avoid duplicate trade alerts.
No exactly-once delivery guarantee is made. Pending alerts expire after three
minutes, and disabling Telegram before dispatch cancels pending delivery.
Events and their delivery records are removed after seven days. Inspect
zencore_telegram_deliveries for delivery status without logging token or codes.

Telegram verification messages are sent only in response to the user's request.
This feature does not enable MT5 execution or submit broker orders.
