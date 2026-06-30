import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";

export const PORTAL_WORKSPACE_PASSWORD = "iwanttypescript";

const DEV_AUTH_SECRET = "sense-sight-dev-auth-secret-change-before-production";

const allowedHosts = [
  "sensesight.live",
  "*.sensesight.live",
  "*.pages.dev",
  "localhost:*",
  "127.0.0.1:*",
];

export function getAuth() {
  return betterAuth({
    appName: "SenseSight Portal",
    baseURL: env.BETTER_AUTH_URL || {
      allowedHosts,
      fallback: "https://sensesight.live",
    },
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET || DEV_AUTH_SECRET,
    trustedOrigins: [
      "https://sensesight.live",
      "https://*.pages.dev",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
  });
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function getDisplayNameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "SenseSight operator";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
