// Classic reCAPTCHA v2 checkbox (free tier, not Enterprise).
// The widget is mounted only when GET /api/waitlist/config returns a site key.
(() => {
  const API = "https://www.google.com/recaptcha/api.js";
  let widgetId = null;
  let siteKey = "";
  let pending = null;

  function loadApi() {
    return new Promise((resolve, reject) => {
      if (window.grecaptcha) {
        resolve();
        return;
      }
      const callback = "firmamentRecaptchaOnload";
      window[callback] = () => resolve();
      const script = document.createElement("script");
      script.src = `${API}?onload=${encodeURIComponent(callback)}&render=explicit`;
      script.async = true;
      script.onerror = () => reject(new Error("Verification is unavailable. Try again."));
      document.head.appendChild(script);
    });
  }

  function mount() {
    if (widgetId != null || !window.grecaptcha || !siteKey) return;
    const el = document.getElementById("recaptcha-widget");
    if (!el) return;
    const size = window.matchMedia("(max-width: 420px)").matches ? "compact" : "normal";
    widgetId = window.grecaptcha.render(el, { sitekey: siteKey, size });
  }

  function boot() {
    if (pending) return pending;
    pending = (async () => {
      let data = {};
      try {
        const response = await fetch("/api/waitlist/config");
        if (response.ok) data = await response.json();
      } catch {
        siteKey = "";
        return;
      }
      siteKey = data && typeof data.recaptchaSiteKey === "string" ? data.recaptchaSiteKey.trim() : "";
      if (!siteKey) return;
      try {
        await loadApi();
        await new Promise((resolve) => window.grecaptcha.ready(resolve));
        mount();
      } catch (error) {
        pending = null;
        throw error;
      }
    })();
    return pending;
  }

  window.firmamentRecaptchaToken = async () => {
    await boot();
    if (!siteKey) return "";
    if (widgetId == null) throw new Error("Verification is unavailable. Try again.");
    const token = window.grecaptcha.getResponse(widgetId);
    if (!token) throw new Error("Please confirm you're not a robot.");
    return token;
  };

  window.firmamentRecaptchaReset = () => {
    if (widgetId != null && window.grecaptcha) {
      try {
        window.grecaptcha.reset(widgetId);
      } catch {
        /* widget already cleared */
      }
    }
  };

  boot().catch(() => {});
})();
