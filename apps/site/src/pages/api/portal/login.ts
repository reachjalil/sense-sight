import type { APIRoute } from "astro";
import {
  DEMO_PORTAL_PASSWORD,
  getDisplayNameFromEmail,
  getAuth,
  normalizeEmail,
} from "../../../lib/auth";
import { recordLoginAttempt } from "../../../lib/portal-audit";
import { appendAuthCookies } from "../../../lib/portal-session";

export const prerender = false;

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function jsonResponse(
  body: Record<string, unknown>,
  init?: ResponseInit,
  authResponse?: Response,
) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  if (authResponse) {
    appendAuthCookies(authResponse, headers);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

async function callAuthEndpoint(
  request: Request,
  origin: string,
  path: "sign-in/email" | "sign-up/email",
  body: Record<string, unknown>,
) {
  const headers = new Headers();
  headers.set("content-type", "application/json");

  for (const name of [
    "cookie",
    "origin",
    "referer",
    "user-agent",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
  ]) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  if (!headers.has("origin")) {
    headers.set("origin", origin);
  }

  return getAuth().handler(
    new Request(`${origin}/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function parseLoginBody(request: Request): Promise<LoginBody> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as LoginBody;
  }

  const formData = await request.formData();
  return {
    email: formData.get("email"),
    password: formData.get("password"),
  };
}

export const POST: APIRoute = async ({ request, url }) => {
  const body = await parseLoginBody(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    await recordLoginAttempt({
      email,
      normalizedEmail,
      outcome: "denied",
      reason: "invalid_email",
      request,
    });
    return jsonResponse(
      { ok: false, message: "Enter a valid email address." },
      { status: 400 },
    );
  }

  if (password !== DEMO_PORTAL_PASSWORD) {
    await recordLoginAttempt({
      email,
      normalizedEmail,
      outcome: "denied",
      reason: "invalid_demo_password",
      request,
    });
    return jsonResponse(
      { ok: false, message: "The portal password is not valid." },
      { status: 401 },
    );
  }

  const authBody = {
    email: normalizedEmail,
    password: DEMO_PORTAL_PASSWORD,
    rememberMe: true,
  };
  const signInResponse = await callAuthEndpoint(
    request,
    url.origin,
    "sign-in/email",
    authBody,
  );

  if (signInResponse.ok) {
    await recordLoginAttempt({
      email,
      normalizedEmail,
      outcome: "success",
      reason: "signed_in",
      request,
    });
    return jsonResponse(
      { ok: true, redirectTo: "/portal" },
      { status: 200 },
      signInResponse,
    );
  }

  const signUpResponse = await callAuthEndpoint(
    request,
    url.origin,
    "sign-up/email",
    {
      ...authBody,
      name: getDisplayNameFromEmail(normalizedEmail),
    },
  );

  if (signUpResponse.ok) {
    await recordLoginAttempt({
      email,
      normalizedEmail,
      outcome: "success",
      reason: "signed_up",
      request,
    });
    return jsonResponse(
      { ok: true, redirectTo: "/portal" },
      { status: 200 },
      signUpResponse,
    );
  }

  await recordLoginAttempt({
    email,
    normalizedEmail,
    outcome: "error",
    reason: `auth_${signUpResponse.status}`,
    request,
  });
  return jsonResponse(
    { ok: false, message: "The portal could not create your demo session." },
    { status: 500 },
  );
};
