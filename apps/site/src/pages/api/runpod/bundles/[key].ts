import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

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

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  const token = new URL(request.url).searchParams.get("token");

  if (!key) {
    return json({ ok: false, message: "Missing bundle key." }, { status: 400 });
  }
  if (!env.RUNPOD_BUNDLES) {
    return json(
      { ok: false, message: "RunPod bundle storage is not configured." },
      { status: 503 }
    );
  }
  if (!env.RUNPOD_BUNDLE_TOKEN || token !== env.RUNPOD_BUNDLE_TOKEN) {
    return json({ ok: false, message: "Not found." }, { status: 404 });
  }

  const object = await env.RUNPOD_BUNDLES.get(key);
  if (!object) {
    return json({ ok: false, message: "Not found." }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", headers.get("content-type") ?? "application/zstd");
  headers.set("content-length", String(object.size));
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
};
