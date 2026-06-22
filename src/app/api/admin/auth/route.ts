import { NextResponse } from "next/server";
import { signAdminJwt } from "@/lib/auth/jwt";

const COOKIE_NAME = "admin_session";
const IS_PROD     = process.env.NODE_ENV === "production";

export async function POST(req: Request) {
  const { password } = await req.json();

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await signAdminJwt();
  const res   = NextResponse.json({ ok: true });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: IS_PROD,
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours in seconds
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
