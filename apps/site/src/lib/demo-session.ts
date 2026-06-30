// Lightweight email-only demo session.
//
// This is intentionally NOT full authentication. The live demo just asks for an
// email (no password) so we know who opened it and keep the console behind a
// one-field gate. The email is stored in a signed cookie so it can't be trivially
// forged, but security is not the goal here — low friction for the demo is.

import { env } from "cloudflare:workers";

const COOKIE_NAME = "ss_portal";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const DEV_SESSION_SECRET = "sense-sight-demo-session-v1";

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.DEMO_SESSION_SECRET || DEV_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface DemoSession {
  email: string;
  exp: number;
}

export async function signSession(email: string): Promise<string> {
  const payload: DemoSession = {
    email,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(body));
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string | undefined | null
): Promise<DemoSession | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = b64urlEncode(await hmac(body));
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body))
    ) as DemoSession;
    if (!payload?.email || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME };
