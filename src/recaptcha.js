// Classic reCAPTCHA (free v2 checkbox or v3 score). Not reCAPTCHA Enterprise.
// Verification is always POST https://www.google.com/recaptcha/api/siteverify.

export const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
export const RECAPTCHA_ACTION = "waitlist";
export const RECAPTCHA_MIN_SCORE = 0.5;

const TOKEN_MAX = 4096;

export function recaptchaKeys(env) {
  const site = typeof env?.RECAPTCHA_SITE_KEY === "string" ? env.RECAPTCHA_SITE_KEY.trim() : "";
  const secret = typeof env?.RECAPTCHA_SECRET_KEY === "string" ? env.RECAPTCHA_SECRET_KEY.trim() : "";
  if (!site || !secret) return null;
  return { site, secret };
}

function overFreeQuota(data) {
  let serialized = "";
  try {
    serialized = JSON.stringify(data);
  } catch {
    return false;
  }
  if (/over free quota/i.test(serialized)) return true;
  const codes = data?.["error-codes"];
  return Array.isArray(codes) && codes.some((code) => /quota/i.test(String(code)));
}

// Returns { ok: true } or { ok: false, reason: "missing" | "invalid" | "unavailable" }.
export async function verifyRecaptchaToken({ token, secret, remoteip, hostname }) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value || value.length > TOKEN_MAX) return { ok: false, reason: "missing" };

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", value);
  const ip = typeof remoteip === "string" ? remoteip.trim() : "";
  // Only forward a plausible client IP. Cloudflare sets CF-Connecting-IP; ignore anything else.
  if (ip && ip.length <= 64 && /^[\da-f:.]+$/i.test(ip)) params.set("remoteip", ip);

  let response;
  try {
    response = await globalThis.fetch(RECAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (!response.ok) return { ok: false, reason: "unavailable" };

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (!data || typeof data !== "object") return { ok: false, reason: "unavailable" };
  // Free-tier siteverify can fail open over the monthly quota (success: true,
  // static score 0.9, "Over free quota."). Reject that so spam is not stored.
  if (overFreeQuota(data)) return { ok: false, reason: "unavailable" };
  if (data.success !== true) return { ok: false, reason: "invalid" };

  const codes = data["error-codes"];
  if (Array.isArray(codes) && codes.length > 0) return { ok: false, reason: "invalid" };

  // v3 score tokens include score and action. v2 checkbox tokens do not.
  if (typeof data.score === "number") {
    if (!(data.score >= RECAPTCHA_MIN_SCORE)) return { ok: false, reason: "invalid" };
    if (data.action !== RECAPTCHA_ACTION) return { ok: false, reason: "invalid" };
  }

  const expected = String(hostname || "").toLowerCase();
  if (typeof data.hostname !== "string" || data.hostname.toLowerCase() !== expected) {
    return {
      ok: false,
      reason: "invalid",
      hostname: typeof data.hostname === "string" ? data.hostname : "",
    };
  }

  return { ok: true };
}
