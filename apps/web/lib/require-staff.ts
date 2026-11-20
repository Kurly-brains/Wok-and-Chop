import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { localApiForHost } from "./local-api-runtime";
import {
  staffSessionPath,
  staffSignInUrl,
  type StaffWorkspace,
} from "./staff-routes";

export async function requireStaff(workspace: StaffWorkspace) {
  const [request, jar] = await Promise.all([headers(), cookies()]);
  const api = localApiForHost(request.get("host") ?? "");
  const sessionCookie = jar.get("wok_customer_session")?.value;
  if (api && sessionCookie && /^[a-f0-9]{64}$/i.test(sessionCookie)) {
    try {
      const session = await fetch(new URL(staffSessionPath, api), {
        headers: { cookie: `wok_customer_session=${sessionCookie}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (session.status === 200 && (await session.json()).authorized === true)
        return;
    } catch {
      // Staff pages require a positive, current authorization response.
    }
  }
  redirect(staffSignInUrl(workspace));
}
