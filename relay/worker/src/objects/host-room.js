function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createHostRoomState({ hostId }) {
  if (typeof hostId !== "string" || hostId.trim().length === 0) {
    throw new TypeError("hostId is required");
  }

  return {
    hostId: hostId.trim(),
    status: "offline",
    connection: null,
    lease: null,
  };
}

export function registerHostConnection(state, { connectionId, connectedAt }) {
  if (!state?.hostId) {
    throw new TypeError("state.hostId is required");
  }
  if (typeof connectionId !== "string" || connectionId.trim().length === 0) {
    throw new TypeError("connectionId is required");
  }

  const next = clone(state);
  const generation = (next.connection?.generation || 0) + 1;

  next.status = "online";
  next.connection = {
    connectionId: connectionId.trim(),
    connectedAt: connectedAt || new Date().toISOString(),
    generation,
  };

  return next;
}

export function acquireControllerLease(
  state,
  { clientId, leaseId, grantedAt, expiresAt },
) {
  if (typeof clientId !== "string" || clientId.trim().length === 0) {
    throw new TypeError("clientId is required");
  }
  if (typeof leaseId !== "string" || leaseId.trim().length === 0) {
    throw new TypeError("leaseId is required");
  }

  const activeLease = state?.lease;
  if (activeLease && activeLease.clientId !== clientId.trim()) {
    throw new Error("Host already has an active controller");
  }

  const next = clone(state);
  next.lease = {
    clientId: clientId.trim(),
    leaseId: leaseId.trim(),
    grantedAt: grantedAt || new Date().toISOString(),
    expiresAt: expiresAt || null,
  };
  return next;
}

export class HostRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = createHostRoomState({ hostId: ctx.id.toString() });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return Response.json({
        ok: true,
        hostId: this.state.hostId,
        status: this.state.status,
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
