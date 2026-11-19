import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check") || args.length > 1) {
  throw new Error("Usage: node ops/sync-agent-instructions.mjs [--check]");
}

const canonicalPath = new URL("../AGENT.md", import.meta.url);
const runnerPath = new URL("../AGENTS.md", import.meta.url);
const canonical = await readFile(canonicalPath);

if (args.includes("--check")) {
  const runner = await readFile(runnerPath);
  if (!canonical.equals(runner)) {
    console.error(
      "AGENTS.md differs from AGENT.md. Run node ops/sync-agent-instructions.mjs and commit both files.",
    );
    process.exitCode = 1;
  } else {
    console.log("AGENT.md and AGENTS.md match exactly.");
  }
} else {
  await writeFile(runnerPath, canonical);
  console.log(
    "Synchronized AGENTS.md from AGENT.md without changing the canonical instructions.",
  );
}
