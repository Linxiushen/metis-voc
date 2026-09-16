/** Reject malformed Origin headers and accept only explicitly trusted origins. */
export function allowedApiOrigin(request: Request, configuredOrigins = ""): string {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return "";
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return "";
    const destination = new URL(request.url);
    if (origin === destination.origin) return origin;
    return configuredOrigins.split(",").map((value) => value.trim()).some((value) => {
      try {
        const allowed = new URL(value);
        return allowed.protocol === "https:" && allowed.origin === value && value === origin;
      } catch {
        return false;
      }
    }) ? origin : "";
  } catch {
    return "";
  }
}
