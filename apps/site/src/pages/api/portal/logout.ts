import type { APIRoute } from "astro";
import { clearSessionCookie } from "../../../lib/demo-session";

export const prerender = false;

export const POST: APIRoute = async ({ redirect }) => {
  const response = redirect("/portal", 303);
  response.headers.append("set-cookie", clearSessionCookie());
  return response;
};
