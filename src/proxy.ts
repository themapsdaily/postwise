/**
 * Next 16 calls this file `proxy` (it was `middleware`). It runs before every
 * route: no valid session cookie means a redirect to /login for pages and a
 * 401 for /api/*. The public paths are listed in src/server/auth.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, authProblem, isPublicPath, verifySession } from "./server/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const problem = authProblem();
  if (problem) {
    return isApi
      ? NextResponse.json({ error: problem }, { status: 500 })
      : new NextResponse(problem, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
