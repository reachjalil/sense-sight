import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";
import { appendAuthCookies } from "../../../lib/portal-session";

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const headers = new Headers();
  headers.set("content-type", "application/json");

  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }
  headers.set("origin", request.headers.get("origin") || url.origin);

  const authResponse = await getAuth().handler(
    new Request(`${url.origin}/api/auth/sign-out`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
  );

  const response = redirect("/portal", 303);
  appendAuthCookies(authResponse, response.headers);
  return response;
};
