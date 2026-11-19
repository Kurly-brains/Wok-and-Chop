const { readStatus, runCheck, recordPaper } = require("./diagnostics.cjs");
const { randomUUID } = require("node:crypto");

async function main() {
  const [action, id] = process.argv.slice(2);
  if (action === "status") return readStatus();
  if (action === "simulate") return runCheck("simulator", id || randomUUID());
  if (action === "test-device" && id) return runCheck("hardware", id);
  if (action === "observed-paper" && id) return recordPaper(id);
  throw new Error("Use status, simulate [test-id], test-device <unique-test-id>, or observed-paper <ID from paper>.");
}

main().then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (["not-sent", "uncertain"].includes(result.outcome)) process.exitCode = 1;
}).catch(error => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
