# Firmament launch site

Coming-soon site for the $Firmament Network™ CryptoPublicOffering™ (CPO), live at
firmnetwork.app and firmwallet.app (plus www). A Cloudflare Worker serves the
static page in `public/` and a small waitlist API in `src/index.js`, backed by a
KV store.

## Commands

```bash
npm install
npm run dev      # local preview (wrangler dev)
npm run deploy   # deploy to Cloudflare (wrangler deploy)
```

## Configuration

- **Countdown:** set `LAUNCH_AT` near the bottom of `public/index.html` to an ISO
  timestamp, e.g. `"2026-12-01T17:00:00Z"`, then redeploy.
- **Domains:** listed under `routes` in `wrangler.jsonc` as custom domains.
- **Public access:** the account-wide "All Workers" Cloudflare Access app gates
  every Worker. The "Firmament launch (public)" Access app bypasses that gate for
  these four hostnames only. Delete it to put the site behind the login again.

## Waitlist API

| Method and path | What it does |
|---|---|
| `POST /api/waitlist` | Body `{ email, wallet?, ref? }`. Returns `{ ok, position, already }`. Emails are deduplicated case-insensitively. A wallet, if given, must be a Solana address. |
| `GET /api/waitlist/count` | Returns `{ count }` |

Each signup is stored in the `WAITLIST` KV namespace as `email:<address>`, and
the running total as `meta:count`. To export the list:

```bash
npx wrangler kv key list --binding WAITLIST --remote
```
