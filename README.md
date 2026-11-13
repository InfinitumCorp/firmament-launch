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
| `POST /api/waitlist` | Body `{ email, wallet?, ref?, recaptchaToken? }`. Returns `{ ok, position, already }`. Emails are deduplicated case-insensitively. `wallet` is accepted on firmnetwork.app only and must be a Solana address. `recaptchaToken` is required only when both reCAPTCHA keys below are set. |
| `GET /api/waitlist/count` | Returns `{ count }` for the site you call it on. |
| `GET /api/waitlist/config` | Returns `{ recaptchaSiteKey }` for the pages, or `{ recaptchaSiteKey: null }` when protection is off. Never returns the secret. |

The hostname picks the list. Signups are stored in the `WAITLIST` KV namespace as
`network:email:<address>` or `wallet:email:<address>`, with running totals in
`network:meta:count` and `wallet:meta:count`. To export the list:

```bash
npx wrangler kv key list --binding WAITLIST --remote
```

## Spam protection (optional)

Signup stays exactly as it is today until **both** of these Worker bindings are non-empty. If either one is missing or blank, `recaptchaToken` is ignored and `siteverify` is not called.

This is classic Google reCAPTCHA, the free non-Enterprise product: a v2 "I'm not a robot" checkbox on the form, checked on the server with `POST https://www.google.com/recaptcha/api/siteverify`. The browser loads `https://www.google.com/recaptcha/api.js`. It does not use reCAPTCHA Enterprise, `enterprise.js`, or `CreateAssessment`.

Create a **v2 Checkbox** key in the reCAPTCHA admin console (not Enterprise, not a score-only v3 key). Allow every hostname that serves a form. For `wrangler dev`, that includes `127.0.0.1` and `localhost`.

| Variable | How to set it | Notes |
|---|---|---|
| `RECAPTCHA_SITE_KEY` | `npx wrangler secret put RECAPTCHA_SITE_KEY` | Public site key. Pages read it from `GET /api/waitlist/config` and render the checkbox only then. Do not commit it. |
| `RECAPTCHA_SECRET_KEY` | `npx wrangler secret put RECAPTCHA_SECRET_KEY` | Secret key. Sent only to Google's siteverify endpoint. Do not commit it. |

For local preview, copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill in both names. v3 tokens are also accepted if a client sends one: the score must be at least 0.5 and `action` must be `waitlist`. The shipped pages use the v2 checkbox. A hostname in Google's response must match the request host. Google's published test keys always report `testkey.google.com`, so this check rejects them; use your own key for a real signup. If siteverify fails open after the free monthly quota (`success: true` plus an "Over free quota." message), the signup is rejected.
