import { sign, verify } from "hono/jwt";

export interface JwtPayload {
  sub: number;
  email: string;
  role: "contributor" | "admin";
  exp?: number;
}

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export async function signToken(
  payload: Omit<JwtPayload, "exp">,
  secret: string,
): Promise<string> {
  return sign(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + SEVEN_DAYS_SECONDS,
    },
    secret,
    "HS256",
  );
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  try {
    const payload = await verify(token, secret, "HS256");
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
