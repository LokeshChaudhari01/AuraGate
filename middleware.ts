import { NextRequest, NextResponse } from "next/server";
import { verifyAdminJwt } from "@/lib/auth/jwt";

export async function middleware(req: NextRequest) {
  // Always allow login and auth endpoints through
  const { pathname } = req.nextUrl;
  if (pathname === "/admin-login")        return NextResponse.next();
  if (pathname === "/api/admin/auth")     return NextResponse.next();

  const token   = req.cookies.get("admin_session")?.value ?? "";
  const payload = token ? await verifyAdminJwt(token) : null;

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin-login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/admin/:path*"],
};
