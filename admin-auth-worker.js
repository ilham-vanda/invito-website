/**
 * Invito admin authentication Worker (Cloudflare Workers module syntax).
 *
 * Required Worker secrets/vars:
 *   ADMIN_ID               non-secret admin identifier (default intended: "admin")
 *   ADMIN_PASSWORD_HASH    PBKDF2-SHA-256 hash encoded as base64url(salt).base64url(hash)
 *   SESSION_SECRET         random secret, at least 32 bytes
 * Required binding:
 *   RATE_LIMIT_KV          KV namespace used for login attempt throttling
 *
 * This is an authentication API module, not the site's current static-site entrypoint.
 * Integrate routes into the existing Worker before deployment; do not replace the
 * current production Worker with this file alone.
 */
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 2048;
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(payload, secret) {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return body + "." + b64url(new Uint8Array(sig));
}
async function verifyToken(token, secret) {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(parts[1]), encoder.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (payload.sub !== "admin" || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
async function passwordMatches(password, encoded) {
  const parts = (encoded || "").split(".");
  if (parts.length !== 2) return false;
  try {
    const salt = fromB64url(parts[0]);
    const expected = fromB64url(parts[1]);
    if (salt.length < 16 || expected.length !== 32) return false;
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, material, 256));
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}
function cookieHeader(value, maxAge) {
  return "invito_admin_session=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const item of raw.split(";")) {
    const idx = item.indexOf("=");
    if (idx > -1 && item.slice(0, idx).trim() === name) return item.slice(idx + 1).trim();
  }
  return "";
}
async function rateLimit(request, env) {
  if (!env.RATE_LIMIT_KV) return { allowed: false, unavailable: true };
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "admin-login:" + await digest(ip);
  const now = Math.floor(Date.now() / 1000);
  let record;
  try { record = await env.RATE_LIMIT_KV.get(key, "json"); }
  catch { return { allowed: false, unavailable: true }; }
  if (record && record.reset > now && record.count >= MAX_ATTEMPTS) return { allowed: false, reset: record.reset };
  const next = record && record.reset > now ? { count: record.count + 1, reset: record.reset } : { count: 1, reset: now + WINDOW_SECONDS };
  try { await env.RATE_LIMIT_KV.put(key, JSON.stringify(next), { expirationTtl: WINDOW_SECONDS }); }
  catch { return { allowed: false, unavailable: true }; }
  return { allowed: true };
}
async function digest(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function validConfig(env) {
  return typeof env.ADMIN_ID === "string" && env.ADMIN_ID.length > 0 &&
    typeof env.ADMIN_PASSWORD_HASH === "string" && env.ADMIN_PASSWORD_HASH.length > 0 &&
    typeof env.SESSION_SECRET === "string" && encoder.encode(env.SESSION_SECRET).length >= 32 &&
    !!env.RATE_LIMIT_KV;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/admin/")) return json({ message: "Not found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 405, headers: { Allow: "POST, GET" } });

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return json({ message: "Permintaan tidak valid." }, 403);
      if (!validConfig(env)) return json({ message: "Autentikasi admin belum dikonfigurasi dengan aman." }, 503);
      if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ message: "Format permintaan tidak valid." }, 415);
      const length = Number(request.headers.get("content-length") || 0);
      if (length > MAX_BODY_BYTES) return json({ message: "Permintaan terlalu besar." }, 413);
      let body;
      try { body = await request.json(); } catch { return json({ message: "Data login tidak valid." }, 400); }
      const adminId = typeof body.adminId === "string" ? body.adminId.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (adminId.length > 128 || password.length > 1024) return json({ message: "ID atau kata sandi tidak valid." }, 400);
      const limit = await rateLimit(request, env);
      if (!limit.allowed) return json({ message: limit.unavailable ? "Login sementara tidak tersedia. Coba lagi nanti." : "Terlalu banyak percobaan. Coba lagi setelah 15 menit." }, limit.unavailable ? 503 : 429);
      const idOk = adminId === env.ADMIN_ID;
      const passwordOk = await passwordMatches(password, env.ADMIN_PASSWORD_HASH);
      if (!idOk || !passwordOk) return json({ message: "ID admin atau kata sandi salah." }, 401);
      const now = Math.floor(Date.now() / 1000);
      const token = await sign({ sub: "admin", iat: now, exp: now + SESSION_SECONDS }, env.SESSION_SECRET);
      return json({ authenticated: true, redirect: "/admin-dashboard.html" }, 200, { "set-cookie": cookieHeader(token, SESSION_SECONDS) });
    }

    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      if (!validConfig(env)) return json({ authenticated: false }, 503);
      const payload = await verifyToken(getCookie(request, "invito_admin_session"), env.SESSION_SECRET);
      return json({ authenticated: !!payload }, payload ? 200 : 401);
    }

    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return json({ message: "Permintaan tidak valid." }, 403);
      return json({ authenticated: false }, 200, { "set-cookie": cookieHeader("", 0) });
    }
    return json({ message: "Not found" }, 404);
  }
};
