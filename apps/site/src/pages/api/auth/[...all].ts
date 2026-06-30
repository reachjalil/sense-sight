import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";

export const prerender = false;

export const ALL: APIRoute = ({ request }) => {
  return getAuth().handler(request);
};
