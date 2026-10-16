import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { StaffRole } from "../data/demo/staff.js";
import { config } from "./config.js";
import { getHqGraph } from "./graph/client.js";
import { H11_STAFF_BY_EMAIL, H18_CLIENTS, H23_STAFF_EXISTS } from "./graph/hq-queries.js";
import { run } from "./graph/queries.js";

/**
 * Staff login for the support desk. Accounts live in the HQ graph; passwords are scrypt-hashed.
 * The session is a signed cookie (HMAC with APP_SECRET), so it survives a server restart.
 */

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** Their job, e.g. "Tech lead". */
  title: string;
}

const COOKIE = "lk_session";
const SESSION_HOURS = 12;

/** Signs session cookies. APP_SECRET in .env; the id salt is the development fallback. */
const signingKey = () => process.env.APP_SECRET || config.idHashSalt;
const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");

function sessionToken(user: StaffUser): string {
  const payload = Buffer.from(JSON.stringify({ user, expires: Date.now() + SESSION_HOURS * 3_600_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): StaffUser | undefined {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as { user: StaffUser; expires: number };
  return session.expires > Date.now() ? session.user : undefined;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export async function logIn(c: Context, email: string, password: string): Promise<StaffUser | undefined> {
  const [row] = await run<StaffUser & { passwordHash: string }>(await getHqGraph(), H11_STAFF_BY_EMAIL, { email: email.trim().toLowerCase() });
  if (!row || !passwordMatches(password, row.passwordHash)) return undefined;

  const user: StaffUser = { id: row.id, name: row.name, email: row.email, role: row.role, title: row.title };
  setCookie(c, COOKIE, sessionToken(user), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_HOURS * 3600 });
  return user;
}

export function logOut(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** The signed-in staff member, if the session is valid and their account still exists (a reset removes accounts). */
export async function currentUser(c: Context): Promise<StaffUser | undefined> {
  const token = getCookie(c, COOKIE);
  const user = token ? readToken(token) : undefined;
  if (!user) return undefined;
  return (await run(await getHqGraph(), H23_STAFF_EXISTS, { id: user.id })).length ? user : undefined;
}

/** Every API route except login and the webhooks needs a logged-in staff member. */
export const requireLogin: MiddlewareHandler<{ Variables: { user: StaffUser } }> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Please log in" }, 401);
  c.set("user", user);
  await next();
};

/** Only some roles may change settings. */
export function requireRole(...roles: StaffRole[]): MiddlewareHandler<{ Variables: { user: StaffUser } }> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) return c.json({ error: "Your role can't do that" }, 403);
    await next();
  };
}

/**
 * Which clients someone may open. Support agents see the clients assigned to them;
 * leads, developers and admins see every client.
 */
export async function visibleClientIds(user: StaffUser): Promise<string[]> {
  const clients = await run<{ id: string; agentId: string }>(await getHqGraph(), H18_CLIENTS);
  return clients.filter((client) => user.role !== "agent" || client.agentId === user.id).map((client) => client.id);
}

export async function canSeeClient(user: StaffUser, clientId: string): Promise<boolean> {
  return (await visibleClientIds(user)).includes(clientId);
}
