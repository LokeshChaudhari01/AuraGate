import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const EXPIRY = "8h";
const ALG    = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("ADMIN_JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface AdminPayload extends JWTPayload {
  role: "admin";
}

export async function signAdminJwt(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifyAdminJwt(
  token: string
): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if ((payload as AdminPayload).role !== "admin") return null;
    return payload as AdminPayload;
  } catch {
    return null; // expired, tampered, or malformed
  }
}
