import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { desktopPetConnections, users } from "@/db/schema";
import { AppError, ForbiddenError } from "@/lib/errors";
import { ensureHome } from "@/lib/home";
import { resolveHomePet } from "./home-pet-provider";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function desktopServerOrigin(value: string) {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)))
    throw new AppError("桌面陪伴需要 HTTPS 服务或本机回环地址");
  return url.origin;
}

export async function createDesktopPairing(userId: string, origin: string) {
  const server = desktopServerOrigin(origin);
  const ticket = `acpair_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  // Prevent abandoned links from accumulating; consumed records stay available for revocation.
  await db.delete(desktopPetConnections).where(and(eq(desktopPetConnections.userId, userId), isNull(desktopPetConnections.sessionHash)));
  const [record] = await db.insert(desktopPetConnections).values({ userId, pairingHash: hash(ticket),
    pairingExpiresAt: new Date(now.getTime() + 90_000), expiresAt: new Date(now.getTime() + 7 * 86400_000) }).returning();
  const launch = new URL("agilecampus-pet://connect");
  launch.searchParams.set("server", server); launch.searchParams.set("ticket", ticket);
  return { connectionId: record.id, launchUrl: launch.toString(), expiresAt: record.pairingExpiresAt.toISOString() };
}

export async function consumeDesktopPairing(ticket: string) {
  if (!/^acpair_[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ForbiddenError("连接邀请无效或已过期，请从家园重新开启");
  const token = `acpet_${randomBytes(32).toString("base64url")}`;
  return db.transaction(async tx => {
    const [record] = await tx.update(desktopPetConnections).set({ sessionHash: hash(token), status: "starting" })
      .where(and(eq(desktopPetConnections.pairingHash, hash(ticket)), isNull(desktopPetConnections.sessionHash), isNull(desktopPetConnections.revokedAt), gt(desktopPetConnections.pairingExpiresAt, new Date())))
      .returning();
    if (!record) throw new ForbiddenError("连接邀请已使用或已过期，请从家园重新开启");
    await tx.update(desktopPetConnections).set({ revokedAt: new Date(), status: "stopped" })
      .where(and(eq(desktopPetConnections.userId, record.userId), ne(desktopPetConnections.id, record.id), isNull(desktopPetConnections.revokedAt)));
    return { connectionId: record.id, token, expiresAt: record.expiresAt.toISOString() };
  });
}

export async function authenticateDesktop(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (acpet_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new ForbiddenError("桌面连接已失效，请从家园重新连接");
  const [record] = await db.select().from(desktopPetConnections).where(and(eq(desktopPetConnections.sessionHash, hash(token)), isNull(desktopPetConnections.revokedAt), gt(desktopPetConnections.expiresAt, new Date())));
  if (!record) throw new ForbiddenError("桌面连接已失效，请从家园重新连接");
  return record;
}
export type DesktopConnection = Awaited<ReturnType<typeof authenticateDesktop>>;

export async function desktopState(record: DesktopConnection) {
  const home = await ensureHome(record.userId);
  const pet = home.pet.petId ? await resolveHomePet(record.userId, home.pet.petId) : null;
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, record.userId));
  return { schemaVersion: 1, ownerName: owner?.name ?? "", pet, status: pet ? "ready" : home.pet.petId ? "unavailable" : "unbound",
    command: record.commandSequence > record.ackSequence ? { sequence: record.commandSequence, action: record.command } : null };
}

export async function desktopHeartbeat(record: DesktopConnection, status: "visible" | "hidden" | "stopped", ackSequence?: number) {
  if (ackSequence !== undefined && ackSequence > record.commandSequence) throw new AppError("不能确认尚未发送的桌面操作");
  await db.update(desktopPetConnections).set({ status, lastSeenAt: new Date(), ackSequence: Math.max(record.ackSequence, ackSequence ?? 0) })
    .where(and(eq(desktopPetConnections.id, record.id), isNull(desktopPetConnections.revokedAt)));
}

export async function desktopStatus(userId: string) {
  const [record] = await db.select().from(desktopPetConnections).where(and(eq(desktopPetConnections.userId, userId), isNull(desktopPetConnections.revokedAt), gt(desktopPetConnections.expiresAt, new Date())))
    .orderBy(desc(desktopPetConnections.createdAt)).limit(1);
  const live = Boolean(record?.lastSeenAt && Date.now() - record.lastSeenAt.getTime() < 30_000 && ["visible", "hidden"].includes(record.status));
  return { connected: live, status: live ? record!.status : "offline", lastSeenAt: record?.lastSeenAt?.toISOString() ?? null };
}
export async function commandDesktop(userId: string, action: "show" | "hide" | "quit" | "disconnect") {
  if (action === "disconnect") {
    await db.update(desktopPetConnections).set({ revokedAt: new Date(), status: "stopped" }).where(and(eq(desktopPetConnections.userId, userId), isNull(desktopPetConnections.revokedAt)));
    return;
  }
  const [record] = await db.select().from(desktopPetConnections).where(and(eq(desktopPetConnections.userId, userId), isNull(desktopPetConnections.revokedAt), gt(desktopPetConnections.expiresAt, new Date()), gt(desktopPetConnections.lastSeenAt, new Date(Date.now() - 30_000))))
    .orderBy(desc(desktopPetConnections.createdAt)).limit(1);
  if (!record) throw new AppError("桌宠程序尚未连接，请先开启桌面陪伴");
  await db.update(desktopPetConnections).set({ command: action, commandSequence: sql`${desktopPetConnections.commandSequence} + 1` }).where(eq(desktopPetConnections.id, record.id));
}
