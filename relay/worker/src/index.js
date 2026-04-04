import { HostRoom } from "./objects/host-room.js";
import {
  claimNextRelayTurn,
  createRelayCall,
  createD1RelayStorage,
  createMemoryRelayStorage,
  createPairingInvite,
  claimPairingInvite,
  completeRelayTurn,
  endRelayCall,
  getActiveRelayCall,
  getRelayCall,
  getRelayTurn,
  listHostSessions,
  listPairedHosts,
  submitRelayTurn,
  updateRelayCall,
  updateRelayTurnProgress,
  upsertHostSessions,
  upsertHostMetadata,
} from "./storage.js";

export { HostRoom };

let fallbackStorage = null;

function nowIso() {
  return new Date().toISOString();
}

function generateInviteId() {
  return `invite_${crypto.randomUUID()}`;
}

function generateInviteCode() {
  return `PAIR-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function getStorage(env) {
  if (env?.RELAY_STORAGE) {
    return env.RELAY_STORAGE;
  }
  if (env?.DB) {
    return createD1RelayStorage(env.DB);
  }
  if (!fallbackStorage) {
    fallbackStorage = createMemoryRelayStorage();
  }
  return fallbackStorage;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const storage = getStorage(env);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "agenthub-relay",
      });
    }

    if (request.method === "POST" && url.pathname === "/api/pairing/invites") {
      const body = await readJson(request);
      if (body.host) {
        await upsertHostMetadata(storage, body.host);
      }

      const createdAt = body.createdAt || nowIso();

      const invite = await createPairingInvite(storage, {
        inviteId: body.inviteId || generateInviteId(),
        hostId: body.host?.hostId || body.hostId,
        code: body.code || generateInviteCode(),
        createdAt,
        expiresAt:
          body.expiresAt ||
          new Date(Date.parse(createdAt) + 5 * 60 * 1000).toISOString(),
      });

      return Response.json({ ok: true, invite });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/pairing/invites/claim"
    ) {
      const body = await readJson(request);
      const pairing = await claimPairingInvite(storage, body);
      return Response.json({ ok: true, pairing });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/clients/") &&
      url.pathname.endsWith("/hosts")
    ) {
      const parts = url.pathname.split("/");
      const clientId = parts[3];
      const hosts = await listPairedHosts(storage, { clientId });
      return Response.json({ ok: true, hosts });
    }

    if (request.method === "POST" && url.pathname === "/api/hosts/sync") {
      const body = await readJson(request);
      if (body.host) {
        await upsertHostMetadata(storage, body.host);
      }
      const sessions = await upsertHostSessions(storage, {
        hostId: body.host?.hostId || body.hostId,
        sessions: body.sessions,
      });
      return Response.json({ ok: true, sessions });
    }

    if (request.method === "POST" && url.pathname === "/api/turns") {
      const body = await readJson(request);
      const turn = await submitRelayTurn(storage, body);
      return Response.json({ ok: true, turn });
    }

    if (request.method === "POST" && url.pathname === "/api/calls") {
      const body = await readJson(request);
      const call = await createRelayCall(storage, body);
      return Response.json({ ok: true, call });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.endsWith("/sessions")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const sessions = await listHostSessions(storage, { hostId });
      return Response.json({ ok: true, sessions });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.endsWith("/calls/active")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const call = await getActiveRelayCall(storage, { hostId });
      return Response.json({ ok: true, call });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.includes("/calls/") &&
      url.pathname.endsWith("/events")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const callId = parts[5];
      const body = await readJson(request);
      const call = await updateRelayCall(storage, {
        callId,
        hostId,
        state: body.state,
        updatedAt: body.updatedAt || nowIso(),
      });
      return Response.json({ ok: true, call });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.endsWith("/turns/claim")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const body = await readJson(request);
      const turn = await claimNextRelayTurn(storage, {
        hostId,
        claimedAt: body.claimedAt,
      });
      return Response.json({ ok: true, turn });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.endsWith("/progress")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const turnId = parts[5];
      const body = await readJson(request);
      const turn = await updateRelayTurnProgress(storage, {
        turnId,
        hostId,
        runtimeSessionId: body.runtimeSessionId,
        agentId: body.agentId,
        assistantMessage: body.assistantMessage,
        updatedAt: body.updatedAt,
      });
      return Response.json({ ok: true, turn });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/hosts/") &&
      url.pathname.endsWith("/complete")
    ) {
      const parts = url.pathname.split("/");
      const hostId = parts[3];
      const turnId = parts[5];
      const body = await readJson(request);
      const turn = await completeRelayTurn(storage, {
        turnId,
        hostId,
        completedAt: body.completedAt,
        runtimeSessionId: body.runtimeSessionId,
        agentId: body.agentId,
        userMessage: body.userMessage,
        assistantMessage: body.assistantMessage,
        error: body.error,
      });
      return Response.json({ ok: true, turn });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/clients/") &&
      url.pathname.endsWith("/end")
    ) {
      const parts = url.pathname.split("/");
      const clientId = parts[3];
      const callId = parts[5];
      const body = await readJson(request);
      const call = await endRelayCall(storage, {
        callId,
        clientId,
        updatedAt: body.updatedAt || nowIso(),
      });
      return Response.json({ ok: true, call });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/clients/") &&
      url.pathname.includes("/calls/")
    ) {
      const parts = url.pathname.split("/");
      const clientId = parts[3];
      const callId = parts[5];
      const call = await getRelayCall(storage, { clientId, callId });
      return Response.json({ ok: true, call });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/clients/") &&
      url.pathname.includes("/turns/")
    ) {
      const parts = url.pathname.split("/");
      const clientId = parts[3];
      const turnId = parts[5];
      const turn = await getRelayTurn(storage, { clientId, turnId });
      return Response.json({ ok: true, turn });
    }

    return new Response("Not found", { status: 404 });
  },
};
