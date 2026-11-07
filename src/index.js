// CPO waitlist API. Everything else is served from ./public by Static Assets.
//   POST /api/waitlist        { email, wallet?, ref? } -> { ok, position, already }
//   GET  /api/waitlist/count  -> { count }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function getCount(env) {
  return Number((await env.WAITLIST.get("meta:count")) || 0);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist/count" && request.method === "GET") {
      return json({ count: await getCount(env) });
    }

    if (url.pathname === "/api/waitlist" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid request." }, 400);
      }
      const email = String(body.email || "").trim().toLowerCase();
      const wallet = String(body.wallet || "").trim();
      if (!EMAIL.test(email)) return json({ ok: false, error: "Enter a valid email address." }, 400);
      if (wallet && !SOL_ADDR.test(wallet)) return json({ ok: false, error: "That isn't a valid Solana address." }, 400);

      const key = `email:${email}`;
      const existing = await env.WAITLIST.get(key, "json");
      if (existing) return json({ ok: true, already: true, position: existing.position });

      const position = (await getCount(env)) + 1;
      await env.WAITLIST.put(
        key,
        JSON.stringify({
          email,
          wallet: wallet || null,
          ref: String(body.ref || "").slice(0, 64) || null,
          position,
          country: request.cf?.country || null,
          host: url.hostname,
          at: new Date().toISOString(),
        })
      );
      await env.WAITLIST.put("meta:count", String(position));
      return json({ ok: true, already: false, position });
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
