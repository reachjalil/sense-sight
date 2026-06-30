import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { sessionCookie, signSession } from "../../../lib/demo-session";

export const prerender = false;

async function parseEmail(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email.trim() : "";
  }
  const formData = await request.formData();
  const email = formData.get("email");
  return typeof email === "string" ? email.trim() : "";
}

// Best-effort: record who opened the demo. Never block sign-in on a log failure
// (and the DB binding isn't present under `astro dev`, so guard for it).
async function recordSignin(
  email: string,
  request: Request,
  db: D1Database | undefined
): Promise<void> {
  try {
    if (!db) return;
    await db
      .prepare(
        "INSERT INTO demo_signin (email, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(
        email,
        request.headers.get("cf-connecting-ip"),
        request.headers.get("user-agent"),
        new Date().toISOString()
      )
      .run();
  } catch {
    // ignore — logging is best-effort
  }
}

// Email-only demo access: no password. Enter a valid email and you're in.
export const POST: APIRoute = async ({ request }) => {
  const email = (await parseEmail(request)).toLowerCase();

  if (!email.includes("@") || email.length < 3) {
    return new Response(
      JSON.stringify({ ok: false, message: "Enter a valid email address." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  await recordSignin(email, request, env.DB);

  const token = await signSession(email);
  return new Response(JSON.stringify({ ok: true, redirectTo: "/console" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookie(token),
    },
  });
};
