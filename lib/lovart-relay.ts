export type LovartRelayMethod = "GET" | "POST";

export type LovartRelayPayload = {
  token: string;
  method: LovartRelayMethod;
  path: string;
  params: Record<string, string>;
  body: Record<string, unknown> | null;
  idempotency_key?: string;
};

export type LovartRelayEnvelope = {
  status: number;
  body: string | null;
  contentType: string;
};

export type LovartTransportReadiness = {
  configured: boolean;
  transport: "direct" | "relay";
  error: string;
};

export function lovartTransportReadiness(value: {
  accessKey: string;
  secretKey: string;
  proxyUrl: string;
  proxyToken: string;
}): LovartTransportReadiness {
  const hasProxyUrl = Boolean(value.proxyUrl);
  const hasProxyToken = Boolean(value.proxyToken);
  if (hasProxyUrl !== hasProxyToken) {
    return {
      configured: false,
      transport: "relay",
      error: "Lovart 中继配置不完整",
    };
  }
  if (hasProxyUrl && hasProxyToken) {
    return { configured: true, transport: "relay", error: "" };
  }
  if (value.accessKey && value.secretKey) {
    return { configured: true, transport: "direct", error: "" };
  }
  return {
    configured: false,
    transport: "direct",
    error: "Lovart 尚未完成服务端配置",
  };
}

export function buildLovartRelayPayload(
  token: string,
  method: LovartRelayMethod,
  path: string,
  params?: Record<string, string>,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): LovartRelayPayload {
  const payload: LovartRelayPayload = {
    token,
    method,
    path,
    params: { ...(params || {}) },
    body: body === undefined ? null : body,
  };
  if (method === "POST" && idempotencyKey) {
    payload.idempotency_key = idempotencyKey;
  }
  return payload;
}

export function parseLovartRelayEnvelope(value: unknown): LovartRelayEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lovart 中继响应格式无效");
  }

  const record = value as Record<string, unknown>;
  const status = Number(record.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error("Lovart 中继未返回有效状态码");
  }

  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  let body: string | null = nullBodyStatus ? null : "";
  if (!nullBodyStatus && typeof record.body === "string") {
    body = record.body;
  } else if (!nullBodyStatus && record.body != null) {
    body = JSON.stringify(record.body);
  }

  const contentType = typeof record.contentType === "string" && record.contentType.trim()
    ? record.contentType.trim()
    : "application/json; charset=utf-8";

  return { status, body, contentType };
}
