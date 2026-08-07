export interface Env {
  SHREE_ROOMS: DurableObjectNamespace<ShreeRoom>;
}

type Role = "desktop" | "phone";
type Lane = "pairing" | "control" | "live";
interface Attachment { role: Role; lane: Lane }

const encoder = new TextEncoder();
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/v1\/rooms\/([A-Za-z0-9_-]{32,80})\/(pairing|control|live)$/);
    if (!match) return new Response("SHREE encrypted relay", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const room = env.SHREE_ROOMS.get(env.SHREE_ROOMS.idFromName(match[1]));
    return room.fetch(new Request(request, { headers: new Headers(request.headers) }));
  },
};

export class ShreeRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const lane = url.pathname.split("/").at(-1) as Lane;
    const requestedRole = request.headers.get("X-Shree-Role");
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!(["desktop", "phone"] as string[]).includes(requestedRole ?? "") || !(["pairing", "control", "live"] as string[]).includes(lane) || bearer.length < 32) {
      return new Response("Invalid relay credentials", { status: 401 });
    }
    const role = requestedRole as Role;

    let desktopHash = await this.ctx.storage.get<string>("desktop_token_hash");
    let phoneHash = await this.ctx.storage.get<string>("phone_token_hash");
    if (!desktopHash || !phoneHash) {
      const suppliedPhoneHash = request.headers.get("X-Shree-Phone-Token-Hash") ?? "";
      if (role !== "desktop" || !/^[a-f0-9]{64}$/.test(suppliedPhoneHash)) return new Response("Room has not been registered", { status: 404 });
      desktopHash = await hash(bearer);
      phoneHash = suppliedPhoneHash;
      await this.ctx.storage.put({ desktop_token_hash: desktopHash, phone_token_hash: phoneHash, created_at: Date.now() });
      await this.ctx.storage.setAlarm(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    const expected = role === "desktop" ? desktopHash : phoneHash;
    if (!safeEqual(await hash(bearer), expected)) return new Response("Invalid relay credentials", { status: 401 });
    if (role === "desktop") await this.ctx.storage.setAlarm(Date.now() + 30 * 24 * 60 * 60 * 1000);

    for (const existing of this.ctx.getWebSockets(`${role}:${lane}`)) existing.close(4001, "Newer SHREE connection replaced this socket");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ role, lane } satisfies Attachment);
    this.ctx.acceptWebSocket(server, [`${role}:${lane}`, lane]);
    const pendingKey = `pending:${role}:${lane}`;
    const pending = await this.ctx.storage.get<string>(pendingKey);
    if (pending) {
      server.send(pending);
      await this.ctx.storage.delete(pendingKey);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment;
    const size = typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
    if (size > 2_000_000) { socket.close(1009, "Encrypted frame is too large"); return; }
    const targetRole: Role = attachment.role === "desktop" ? "phone" : "desktop";
    const peers = this.ctx.getWebSockets(`${targetRole}:${attachment.lane}`);
    for (const peer of peers) peer.send(message);
    if (peers.length === 0 && typeof message === "string" && attachment.lane !== "live") {
      await this.ctx.storage.put(`pending:${targetRole}:${attachment.lane}`, message);
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> { socket.close(code, reason); }
  async webSocketError(socket: WebSocket): Promise<void> { socket.close(1011, "Relay socket failed"); }
  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) socket.close(4004, "SHREE relay room expired");
    await this.ctx.storage.deleteAll();
  }
}
import { DurableObject } from "cloudflare:workers";
