import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: send visitors without a session cookie to the right login page.
 *  The API still checks every request (roles, suspensions, expiry). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // The student app and the admin console have separate sessions (see backend security.COOKIES).
  const has = (access: string, marker: string) => req.cookies.has(access) || req.cookies.has(marker);
  const student = has("inn_at", "inn_s");
  const staff = has("inn_aat", "inn_as");
  const inAdmin = pathname.startsWith("/admin");
  const publicAdmin = ["/admin/login", "/admin/signup", "/admin/reset-password"].some((p) => pathname.startsWith(p));
  if (publicAdmin || (inAdmin ? staff : student)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = inAdmin ? "/admin/login" : "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app/:path*", "/onboarding/:path*", "/admin/:path*"] };
