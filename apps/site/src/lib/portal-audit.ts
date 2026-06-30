import { env } from "cloudflare:workers";

type LoginAttemptOutcome = "success" | "denied" | "error";

interface LoginAttemptInput {
  email: string;
  normalizedEmail: string;
  outcome: LoginAttemptOutcome;
  reason: string;
  request: Request;
}

export async function recordLoginAttempt({
  email,
  normalizedEmail,
  outcome,
  reason,
  request,
}: LoginAttemptInput) {
  const ipAddress =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    null;
  const userAgent = request.headers.get("user-agent") || null;

  await env.DB.prepare(
    `INSERT INTO login_attempt (
      email,
      normalized_email,
      outcome,
      reason,
      ip_address,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      email,
      normalizedEmail,
      outcome,
      reason,
      ipAddress,
      userAgent,
      new Date().toISOString()
    )
    .run();
}
