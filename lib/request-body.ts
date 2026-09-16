export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await request.body?.cancel("request body too large");
    } catch {
      // The size error remains authoritative if the source cannot be cancelled.
    }
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel("request body too large");
      } catch {
        // The size error remains authoritative if the source cannot be cancelled.
      }
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
