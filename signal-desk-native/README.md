# Signal Desk inside Errante Analysis

The Errante-only `/analysis` response mounts the same seven static report assets as the private Signal Desk Site (`appgprj_6ae177b62cdc8191be4df1b7ab8db208`). Both open **Data sebenar** by default. Timeframe and 30/60-minute controls remain available inside the report. Analysis TF2/TF15 tabs also update the embedded report.

The native `/signal-desk/` document and every asset require the existing account session. Only this document permits same-origin framing. The original installation receives no injected module or new routes. There is no cross-origin cookie sharing with the private Site.

The native Pine + technical view reads only the existing authenticated analysis and candle GET endpoints while visible. Actual timestamps, confirmation and server fields are retained; missing history or checks remain waiting. Fusion V1 is research and cannot execute orders or certify win rate. The standalone Site keeps manual import and sample modes.

To update both views, run the Site checks, then `node scripts/sync-signal-desk.cjs /absolute/path/to/site/dist`. The manifest test verifies all bundled hashes. Deploy the Site privately and merge the application change only into the Errante deployment branch.

The standalone private Site uses a user-opened `/signal-desk/?bridge=1&view=live` authenticated window. It sends validated market-only data to the single allowlisted Site origin. The receiver checks both origin and exact popup source. Both TF feeds are sent independently; missing TF2 must not block TF15. Keep the connection window open. Cookies and credentials never leave Errante.
