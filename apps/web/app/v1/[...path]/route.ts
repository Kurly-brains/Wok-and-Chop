import type { NextRequest } from "next/server";
import { isLoopbackHost, localApiForHost } from "../../../lib/local-api-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewReads = new Set([
  "health",
  "readiness",
  "availability",
  "menu",
  "auth/me",
  "auth/deliveries/config",
  "auth/pickups/config",
  "guest-services/config",
  "marketing/config",
]);

function error(status: number, code: string, message: string) {
  return Response.json({ code, message }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

async function isOneClickUnsubscribe(request: NextRequest) {
  if (!request.body) return false;
  const reader = request.body.getReader();
  const data = new Uint8Array(2048);
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > data.byteLength) {
        await reader.cancel();
        return false;
      }
      data.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    const form = await new Response(data.subarray(0, length), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const field = form.getAll("List-Unsubscribe");
    return field.length === 1 && field[0] === "One-Click";
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path.every(part => /^[a-z0-9][a-z0-9_-]*$/i.test(part))) {
    return error(404, "NOT_FOUND", "API route not found.");
  }

  const binding = process.env.WOK_API_URL;
  const host = request.headers.get("host") ?? "";
  const local = isLoopbackHost(request.nextUrl.host) ? localApiForHost(host) : null;
  const apiPath = path.join("/");
  const oneClick = request.method === "POST" && apiPath === "marketing/unsubscribe" &&
    request.nextUrl.searchParams.has("token") &&
    /^(?:application\/x-www-form-urlencoded|multipart\/form-data)\s*(?:;|$)/i.test(request.headers.get("content-type") ?? "");
  if (local && request.method === "POST" && !oneClick && request.headers.get("origin") !== new URL(`http://${host}`).origin) {
    return error(403, "ORIGIN_REJECTED", "Use the local Wok & Chop website to make this request.");
  }

  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!local && (!isRead || !previewReads.has(apiPath))) {
    return error(503, "LOCAL_WORKFLOW_ONLY", "This feature is currently available in the local restaurant preview.");
  }
  const base = local ?? binding;
  if (!base) {
    return error(503, "API_UNAVAILABLE", "The restaurant API is temporarily unavailable.");
  }

  try {
    const upstreamUrl = new URL(`v1/${apiPath}`, base.endsWith("/") ? base : base + "/");
    upstreamUrl.search = request.nextUrl.search;
    const headers = new Headers();
    if (oneClick) {
      if (!(await isOneClickUnsubscribe(request))) {
        return error(400, "INVALID_UNSUBSCRIBE", "The unsubscribe request is invalid.");
      }
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    } else if (local) {
      for (const key of ["cookie", "origin", "content-type"]) {
        const value = request.headers.get(key);
        if (value) headers.set(key, value);
      }
    }
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: oneClick ? "List-Unsubscribe=One-Click" : isRead ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(local && /^auth\/admin\/printer(?:\/|$)/.test(apiPath) ? 40_000 : 8000),
    });
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const type = upstream.headers.get("content-type");
    if (type) responseHeaders.set("Content-Type", type);
    if (local) {
      for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return error(503, "API_UNAVAILABLE", "The restaurant API is temporarily unavailable.");
  }
}

export { forward as GET, forward as HEAD, forward as POST };
