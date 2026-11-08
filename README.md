# Firmament launch site

Two coming-soon sites served by one Cloudflare Worker, chosen by hostname:

| Domain (plus www) | Site | Source |
|---|---|---|
| firmnetwork.app | $Firmament Network™ CryptoPublicOffering™ (CPO™) | `public/network/` |
| firmwallet.app | $FIRM Wallet™ product page and early access | `public/wallet/` |

Shared styles live in `public/shared/site.css`. `src/index.js` routes each request
to the right folder and runs a separate waitlist for each site, backed by KV.

## Commands

```bash
npm install
npm run dev      # local preview (wrangler dev)
npm run deploy   # deploy to Cloudflare (wrangler deploy)
```

## Configuration

- **Countdown:** set `LAUNCH_AT` near the bottom of `public/network/index.html` to an ISO
  timestamp, e.g. `"2026-12-01T17:00:00Z"`, then redeploy.
- **Domains:** listed under `routes` in `wrangler.jsonc` as custom domains.
- **Public access:** the account-wide "All Workers" Cloudflare Access app gates
  every Worker. The "Firmament launch (public)" Access app bypasses that gate for
  these four hostnames only. Delete it to put the site behind the login again.

## Waitlist API

| Method and path | What it does |
|---|---|
| `POST /api/waitlist` | Body `{ email, wallet?, ref? }`. Returns `{ ok, position, already }`. Emails are deduplicated case-insensitively. `wallet` is accepted on firmnetwork.app only and must be a Solana address. |
| `GET /api/waitlist/count` | Returns `{ count }` for the site you call it on. |

The hostname picks the list. Signups are stored in the `WAITLIST` KV namespace as
`network:email:<address>` or `wallet:email:<address>`, with running totals in
`network:meta:count` and `wallet:meta:count`. To export the list:

```bash
npx wrangler kv key list --binding WAITLIST --remote
```
