# ZenCore Web Control — Deploy Ready

## Local test
1. Install Node.js 20+.
2. In this folder run:
   `npm start`
3. Open http://localhost:8080

## Render
Create a Render **Web Service** from a GitHub repository containing these files.

Recommended fields:
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment variable:
  - Key: `ZENCORE_SECRET`
  - Value: choose your own long random secret

After deploy, Render gives you an HTTPS address such as:
`https://YOUR-SERVICE.onrender.com`

Dashboard:
`https://YOUR-SERVICE.onrender.com/`

TradingView webhook:
`https://YOUR-SERVICE.onrender.com/webhook`

## Pine
In `ZenCore_AI_Dashboard_Pro_WebBridge.pine`:
1. Add script to chart.
2. Settings > WEB DASHBOARD BRIDGE.
3. Put the SAME value used for `ZENCORE_SECRET` into `Webhook Secret`.
4. Enable Web Dashboard Feed.

## TradingView alert
1. Create Alert.
2. Condition: ZenCore indicator > Any alert() function call.
3. Enable Webhook URL.
4. Paste your `/webhook` HTTPS URL.
5. No custom alert message is required for the bridge payload; the Pine `alert()` call supplies JSON.

## Important for live trading
TradingView webhook receivers need to respond quickly. An always-on web service is safer than a service that sleeps after inactivity.
