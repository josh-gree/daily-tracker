// Every /api request must carry a valid Cloudflare Access token for one of the
// allowed emails. Access already blocks everyone else at the edge; this check
// means the data stays private even if Access is ever switched off or
// misconfigured. Missing settings fail closed.
//
// Settings (Pages → Settings → Variables):
//   ACCESS_TEAM_DOMAIN  e.g. "myteam.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   ALLOWED_EMAILS      comma-separated, e.g. "mum@example.com,me@example.com"

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

let certsCache = { url: "", at: 0, keys: [] };
async function signingKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (certsCache.url === url && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't fetch Access keys (${res.status})`);
  certsCache = { url, at: Date.now(), keys: (await res.json()).keys || [] };
  return certsCache.keys;
}

export async function verifyAccessToken(token, env) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const header = json(h), payload = json(p);
  if (header.alg !== "RS256") return null;
  const jwk = (await signingKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!(payload.exp > now) || (payload.nbf && payload.nbf > now + 60)) return null;
  const email = String(payload.email || "").toLowerCase();
  const allowed = String(env.ALLOWED_EMAILS || "").toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
  return allowed.includes(email) ? email : null;
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) {
    return Response.json({ error: "server not configured" }, { status: 500 });
  }
  const cookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("Cookie") || "");
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie?.[1];
  let email = null;
  try { email = await verifyAccessToken(token, env); } catch { /* treated as not signed in */ }
  if (!email) return Response.json({ error: "not signed in" }, { status: 401 });
  ctx.data.email = email;
  return ctx.next();
}
