import { RunPodClient } from "@sense-sight/runpod-orchestrator";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { COOKIE_NAME, verifySession } from "../../../lib/demo-session";

export const prerender = false;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = await verifySession(cookies.get(COOKIE_NAME)?.value);
  if (!session && !import.meta.env.DEV) {
    return json(
      { ok: false, message: "Portal session required." },
      { status: 401 }
    );
  }

  if (!env.RUNPOD_API_KEY || !env.RUNPOD_ENDPOINT_ID) {
    return json(
      {
        ok: false,
        configured: {
          runpodApiKey: Boolean(env.RUNPOD_API_KEY),
          runpodEndpointId: Boolean(env.RUNPOD_ENDPOINT_ID),
        },
      },
      { status: 503 }
    );
  }

  try {
    const client = new RunPodClient({ apiKey: env.RUNPOD_API_KEY });
    const health = await client.endpointHealth(env.RUNPOD_ENDPOINT_ID);
    return json({
      ok: true,
      endpointId: env.RUNPOD_ENDPOINT_ID,
      health,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "RunPod health check failed.",
      },
      { status: 502 }
    );
  }
};
