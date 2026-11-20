import { createApplication } from "./app";
import { emailConfigured } from "./notifications";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The API foundation is not production-ready; complete the launch gates before deployment.");
  }
  const port = Number(process.env.API_PORT ?? "4000");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid port.");
  const app = await createApplication({
    authDatabaseUrl: process.env.AUTH_DATABASE_URL,
    webOrigin: process.env.WEB_ORIGIN,
    dispatchEmails: true,
  });
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`Wok & Chop API preview: http://127.0.0.1:${port}/v1/health\nEmail: ${emailConfigured() ? "Hostinger SMTP configured" : "local preview"}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "API failed to start"}\n`);
  process.exitCode = 1;
});
