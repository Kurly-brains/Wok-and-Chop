import { createApplication } from "./app";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The API foundation is not production-ready; complete the launch gates before deployment.");
  }
  const port = Number(process.env.API_PORT ?? "4000");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid port.");
  const app = await createApplication({ authDatabaseUrl: process.env.AUTH_DATABASE_URL, webOrigin: process.env.WEB_ORIGIN });
  await app.listen(port, "127.0.0.1");
  process.stdout.write(`Wok & Chop API foundation: http://127.0.0.1:${port}/v1/health\nOnline ordering remains disabled.\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "API failed to start"}\n`);
  process.exitCode = 1;
});
