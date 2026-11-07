// Two sites, one Worker. The hostname picks the site:
//   firmwallet.app (+www)   -> public/wallet/  ($FIRM Wallet™ early access)
//   everything else         -> public/network/ ($Firmament Network™ CPO™)
// /shared/* is served as-is to both. Each site has its own waitlist in KV.
//   POST /api/waitlist        { email, wallet?, ref? } -> { ok, position, already }
//   GET  /api/waitlist/count  -> { count }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const siteFor = (host) => (host.includes("firmwallet") ? "wallet" : "network");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = siteFor(url.hostname);
    const countKey = `${site}:meta:count`;
    const getCount = async () => Number((await env.WAITLIST.get(countKey)) || 0);

    if (url.pathname === "/api/waitlist/count" && request.method === "GET") {
      return json({ count: await getCount() });
    }

    if (url.pathname === "/api/waitlist" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid request." }, 400);
      }
      const email = String(body.email || "").trim().toLowerCase();
      const wallet = site === "network" ? String(body.wallet || "").trim() : "";
      if (!EMAIL.test(email)) return json({ ok: false, error: "Enter a valid email address." }, 400);
      if (wallet && !SOL_ADDR.test(wallet)) return json({ ok: false, error: "That isn't a valid Solana address." }, 400);

      const key = `${site}:email:${email}`;
      const existing = await env.WAITLIST.get(key, "json");
      if (existing) return json({ ok: true, already: true, position: existing.position });

      const position = (await getCount()) + 1;
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
      await env.WAITLIST.put(countKey, String(position));
      return json({ ok: true, already: false, position });
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Not found." }, 404);
    if (url.pathname.startsWith("/shared/") || url.pathname === "/404.html") return env.ASSETS.fetch(request);

    const rewritten = new URL(url);
    rewritten.pathname = `/${site}${url.pathname}`;
    return env.ASSETS.fetch(new Request(rewritten, request));
  },
};
