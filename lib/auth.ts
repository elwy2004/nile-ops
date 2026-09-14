import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q, one } from "./db";
import type { Role } from "./workflow";

export { hashPassword, verifyPassword } from "./auth-crypto";

const COOKIE = "nileops_session";
const SESSION_DAYS = 14;

export type SessionUser = { id: number; email: string; name: string; role: Role };

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await q("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [token, userId, expires]);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q("DELETE FROM sessions WHERE token = $1", [token]);
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Expired sessions are swept as they are hit. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = await one<SessionUser & { expires_at: Date }>(
    `SELECT u.id, u.email, u.name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND u.active`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await q("DELETE FROM sessions WHERE token = $1", [token]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Use in every page and action that requires a signed-in user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/quotes?denied=1");
  return user;
}
