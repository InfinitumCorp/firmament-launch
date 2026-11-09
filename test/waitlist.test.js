import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import worker from "../src/index.js";

const SITE_KEY = "test-site-key";
const SECRET = "test-secret-key";
const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const EMAIL = "Ada@Example.com";

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}

function testEnv(extra = {}) {
  return {
    WAITLIST: memoryKv(),
    ASSETS: { async fetch() { return new Response("asset", { status: 200 }); } },
    ...extra,
  };
}

async function call(env, path, { method = "GET", body, host = "firmnetwork.app", headers = {}, fetchImpl } = {}) {
  const previous = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    return await worker.fetch(
      new Request(`https://${host}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      env
    );
  } finally {
    globalThis.fetch = previous;
  }
}

function forbidVerify() {
  return async () => {
    throw new Error("siteverify should not be called");
  };
}

function siteverify(payload, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

async function stored(env, email = "ada@example.com") {
  return env.WAITLIST.get(`network:email:${email}`, "json");
}

describe("waitlist reCAPTCHA", { concurrency: 1 }, () => {
  test("disabled: signup succeeds without a token and does not call siteverify", async () => {
    const cases = [
      {},
      { RECAPTCHA_SITE_KEY: SITE_KEY },
      { RECAPTCHA_SECRET_KEY: SECRET },
      { RECAPTCHA_SITE_KEY: "  ", RECAPTCHA_SECRET_KEY: "  " },
      { RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: "" },
    ];
    for (const keys of cases) {
      const env = testEnv(keys);
      const response = await call(env, "/api/waitlist", {
        method: "POST",
        body: { email: EMAIL, ref: "friend", recaptchaToken: "ignored-junk" },
        fetchImpl: forbidVerify(),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, already: false, position: 1 });
      const row = await stored(env);
      assert.equal(row.email, "ada@example.com");
      assert.equal(row.ref, "friend");
      assert.equal(row.wallet, null);
      assert.equal(await env.WAITLIST.get("network:meta:count"), "1");
    }
  });

  test("disabled: config hides the site key and an invalid email is unchanged", async () => {
    const env = testEnv();
    const config = await call(env, "/api/waitlist/config", { fetchImpl: forbidVerify() });
    assert.deepEqual(await config.json(), { recaptchaSiteKey: null });

    const response = await call(env, "/api/waitlist", {
      method: "POST",
      body: { email: "not-an-email" },
      fetchImpl: forbidVerify(),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "Enter a valid email address." });
    assert.equal(env.WAITLIST.store.size, 0);
  });

  test("valid token: v2 siteverify success stores the signup", async () => {
    const env = testEnv({ RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: SECRET });
    const { calls, fetchImpl } = siteverify({
      success: true,
      challenge_ts: "2026-11-09T00:00:00Z",
      hostname: "firmnetwork.app",
    });
    const response = await call(env, "/api/waitlist", {
      method: "POST",
      body: { email: EMAIL, wallet: "", ref: "friend", recaptchaToken: "good-token" },
      headers: { "CF-Connecting-IP": "203.0.113.5" },
      fetchImpl,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, already: false, position: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, VERIFY_URL);
    assert.equal(calls[0].url.includes(SECRET), false);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
    const params = new URLSearchParams(calls[0].init.body);
    assert.equal(params.get("secret"), SECRET);
    assert.equal(params.get("response"), "good-token");
    assert.equal(params.get("remoteip"), "203.0.113.5");
    assert.equal((await stored(env)).position, 1);

    const config = await call(env, "/api/waitlist/config");
    const configBody = await config.json();
    assert.deepEqual(configBody, { recaptchaSiteKey: SITE_KEY });
    assert.equal(JSON.stringify(configBody).includes(SECRET), false);
  });

  test("valid token: v3 score and waitlist action are accepted", async () => {
    const env = testEnv({ RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: SECRET });
    const { calls, fetchImpl } = siteverify({
      success: true,
      score: 0.9,
      action: "waitlist",
      hostname: "www.firmwallet.app",
    });
    const response = await call(env, "/api/waitlist", {
      method: "POST",
      host: "www.firmwallet.app",
      body: { email: EMAIL, recaptchaToken: "v3-token" },
      fetchImpl,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).position, 1);
    assert.equal(calls.length, 1);
    assert.equal(await env.WAITLIST.get("wallet:email:ada@example.com", "json") instanceof Object, true);
  });

  test("invalid token: siteverify failure does not store the signup", async () => {
    const env = testEnv({ RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: SECRET });
    const { calls, fetchImpl } = siteverify({
      success: false,
      "error-codes": ["invalid-input-response"],
    });
    const response = await call(env, "/api/waitlist", {
      method: "POST",
      body: { email: EMAIL, recaptchaToken: "bad-token" },
      fetchImpl,
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { ok: false, error: "Verification failed. Please try again." });
    assert.equal(JSON.stringify(body).includes(SECRET), false);
    assert.equal(calls.length, 1);
    assert.equal(new URLSearchParams(calls[0].init.body).get("response"), "bad-token");
    assert.equal(env.WAITLIST.store.size, 0);
  });

  test("invalid token: missing token, low score, wrong action, and hostname mismatch", async () => {
    const keys = { RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: SECRET };
    const rejected = [
      { token: "", payload: null, status: 400, error: "Please confirm you're not a robot." },
      { token: "   ", payload: null, status: 400, error: "Please confirm you're not a robot." },
      {
        token: "low",
        payload: { success: true, score: 0.1, action: "waitlist", hostname: "firmnetwork.app" },
        status: 400,
        error: "Verification failed. Please try again.",
      },
      {
        token: "wrong-action",
        payload: { success: true, score: 0.9, action: "login", hostname: "firmnetwork.app" },
        status: 400,
        error: "Verification failed. Please try again.",
      },
      {
        token: "wrong-host",
        payload: { success: true, hostname: "evil.example" },
        status: 400,
        error: "Verification failed. Please try again.",
      },
    ];

    for (const scenario of rejected) {
      const env = testEnv(keys);
      const { calls, fetchImpl } = siteverify(scenario.payload || {});
      const response = await call(env, "/api/waitlist", {
        method: "POST",
        body: { email: EMAIL, recaptchaToken: scenario.token },
        fetchImpl: scenario.payload ? fetchImpl : forbidVerify(),
      });
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), { ok: false, error: scenario.error });
      assert.equal(env.WAITLIST.store.size, 0);
      assert.equal(calls.length, scenario.payload ? 1 : 0);
    }
  });

  test("invalid token: over-quota fail-open and siteverify outages do not store a signup", async () => {
    const keys = { RECAPTCHA_SITE_KEY: SITE_KEY, RECAPTCHA_SECRET_KEY: SECRET };

    const quotaEnv = testEnv(keys);
    const quota = siteverify({
      success: true,
      score: 0.9,
      hostname: "firmnetwork.app",
      "error-codes": ["Over free quota."],
    });
    const quotaResponse = await call(quotaEnv, "/api/waitlist", {
      method: "POST",
      body: { email: EMAIL, recaptchaToken: "quota-token" },
      fetchImpl: quota.fetchImpl,
    });
    assert.equal(quotaResponse.status, 503);
    assert.deepEqual(await quotaResponse.json(), { ok: false, error: "Verification is unavailable. Try again." });
    assert.equal(quotaEnv.WAITLIST.store.size, 0);

    const downEnv = testEnv(keys);
    const downResponse = await call(downEnv, "/api/waitlist", {
      method: "POST",
      body: { email: EMAIL, recaptchaToken: "any-token" },
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(downResponse.status, 503);
    assert.equal(downEnv.WAITLIST.store.size, 0);
  });

  test("client pages load the classic widget and send its token", () => {
    const network = readFileSync(new URL("../public/network/index.html", import.meta.url), "utf8");
    const wallet = readFileSync(new URL("../public/wallet/index.html", import.meta.url), "utf8");
    const client = readFileSync(new URL("../public/shared/recaptcha.js", import.meta.url), "utf8");
    const server = readFileSync(new URL("../src/recaptcha.js", import.meta.url), "utf8");

    for (const html of [network, wallet]) {
      assert.match(html, /src="\/shared\/recaptcha\.js"/);
      assert.match(html, /id="recaptcha-widget"/);
      assert.match(html, /firmamentRecaptchaToken/);
      assert.match(html, /recaptchaToken/);
      assert.doesNotMatch(html, /recaptchaenterprise/i);
      assert.doesNotMatch(html, /enterprise\.js/);
    }
    assert.match(client, /https:\/\/www\.google\.com\/recaptcha\/api\.js/);
    assert.match(client, /grecaptcha\.getResponse/);
    assert.doesNotMatch(client, /enterprise\.js/i);
    assert.doesNotMatch(client, /recaptchaenterprise/i);
    assert.doesNotMatch(client, /grecaptcha\.enterprise/);
    assert.match(server, /https:\/\/www\.google\.com\/recaptcha\/api\/siteverify/);
    assert.doesNotMatch(server, /recaptchaenterprise/i);
    assert.doesNotMatch(server, /CreateAssessment/);
  });
});
