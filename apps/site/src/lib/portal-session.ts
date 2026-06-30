import { getAuth } from "./auth";

interface PortalSessionUser {
  id: string;
  email: string;
  name?: string | null;
}

interface PortalSessionResponse {
  user?: PortalSessionUser | null;
}

export async function getPortalSession(request: Request, origin: string) {
  const sessionRequest = new Request(`${origin}/api/auth/get-session`, {
    headers: request.headers,
  });
  const response = await getAuth().handler(sessionRequest);

  if (!response.ok) {
    return null;
  }

  const session = (await response.json()) as PortalSessionResponse | null;
  return session?.user ?? null;
}

export function appendAuthCookies(from: Response, to: Headers) {
  const source = from.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = source.getSetCookie?.() ?? [];

  if (cookies.length > 0) {
    for (const cookie of cookies) {
      to.append("set-cookie", cookie);
    }
    return;
  }

  const cookie = from.headers.get("set-cookie");
  if (cookie) {
    to.append("set-cookie", cookie);
  }
}
