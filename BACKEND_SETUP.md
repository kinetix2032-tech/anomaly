# ANOMALY backend setup

This folder prepares a separate Cloudflare Worker for the GitHub Pages storefront. GitHub Pages serves HTML/CSS/JavaScript only; it must not contain the Printful API token.

## What this backend does right now

- `GET /health`: reports whether the Printful and Turnstile secrets are configured. It never returns their values.
- `GET /api/catalog`: returns the ANM-001 product and the approved size/price map.
- `POST /api/shipping-rates`: validates the requested sizes and quantities, then requests current Printful shipping rates. This route stays disabled until both `PRINTFUL_TOKEN` and `TURNSTILE_SECRET_KEY` are set and the website includes a Turnstile challenge.
- `POST /api/checkout`: deliberately returns a disabled response. It creates no Printful order.

This backend does not create or confirm Printful orders yet. That must only be added after checkout has a verified successful payment webhook. Printful charges the store owner for fulfillment when an order is submitted for fulfillment, so a customer-facing purchase must not trigger it before payment is verified.

## Deploy through the Cloudflare dashboard

1. Open Cloudflare Dashboard, then **Workers & Pages**.
2. Create a Worker, name it `anomaly-api`, and open its code editor.
3. Replace the starter code with the contents of `backend/worker.js` in this repository. Deploy it.
4. In the Worker settings, open **Variables and Secrets** and add a **Secret** named `PRINTFUL_TOKEN`. Paste your Printful private token into the Cloudflare secret field only. Do not put it into GitHub, HTML, JavaScript, this README, or a chat message. Deploy again.
5. Copy the Worker URL. Open `/health` on that URL. It should show `status: "ok"` and `printfulTokenConfigured: true`.
6. Open `/api/catalog` on that URL to confirm the ANM-001 size/price map is served.

Do not connect the shipping endpoint to the public checkout yet. Before that route is enabled, create a Cloudflare Turnstile widget for the storefront and add its secret to the Worker as `TURNSTILE_SECRET_KEY`. The checkout UI still stays disabled until the payment step is added.

## Important safety boundary

- Do not add real API tokens to repository files.
- Do not accept retail prices or arbitrary Printful variant IDs from the browser. The Worker validates sizes/variants against its own allowlist.
- Do not add a route that confirms Printful fulfillment until payment is verified server-side.
- Do not claim a newsletter signup, order, or payment succeeded unless the relevant service actually confirms it.
