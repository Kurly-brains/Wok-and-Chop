const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const { renderKitchenTicket } = require("../../packages/printing/src/index.ts");

const columns = 42;
const testIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{2,63}$/;

function configuredDevice() {
  const host = process.env.WOK_PRINTER_IPV4;
  const port = Number(process.env.WOK_PRINTER_PORT || 9100);
  if (!host) return null;
  const [first, second] = host.split(".").map(Number);
  const local = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  if (!net.isIPv4(host) || !local || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set WOK_PRINTER_IPV4 to the printer's private LAN IPv4 address and WOK_PRINTER_PORT to its raw TCP port.");
  }
  return { host, port };
}

function specimen(id) {
  const body = renderKitchenTicket({
    schemaVersion: 1, ticketType: "HOLD", orderNumber: "TEST", station: "Printer check",
    pickupLabel: "No pickup - setup only",
    lines: [{ quantity: 1, name: "Alignment and wrapping check", modifiers: ["Synthetic item for the kitchen printer setup"], note: "Test message only." }],
  }, columns);
  // Only this fixed, printable ASCII specimen and line feeds ever enter the adapter.
  const text = ["PRINTER TEST / DO NOT PREPARE", body, "End of printer test", ...id.match(/.{1,42}/g), ""].join("\n")
    .replaceAll("×", "x").replaceAll("—", "-");
  return Buffer.from(text + "\n\n", "ascii");
}

function openJournal() {
  const directory = process.env.WOK_PRINTER_DIAGNOSTICS_DIR || path.join(homedir(), ".wok-and-chop", "printer");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "checks.sqlite"));
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS checks (
      mode TEXT NOT NULL, id TEXT NOT NULL, target TEXT NOT NULL, digest TEXT NOT NULL,
      outcome TEXT NOT NULL, created TEXT NOT NULL, ticket TEXT NOT NULL, PRIMARY KEY(mode,id)
    );
    CREATE TABLE IF NOT EXISTS paper_observations (
      id TEXT PRIMARY KEY, observed_at TEXT NOT NULL
    )`);
  return { directory, db };
}

function publicRecord(row) {
  if (!row) return null;
  // A restart during a send gives us no proof that a physical ticket did or did not emerge.
  const outcome = row.outcome === "sending" ? "uncertain" : row.outcome;
  return { id: row.id, mode: row.mode, outcome, created: row.created,
    digest: row.digest, ticket: row.ticket.trimEnd() };
}

function readStatus() {
  const { db } = openJournal();
  try {
    const recent = db.prepare("SELECT * FROM checks WHERE mode=? ORDER BY rowid DESC LIMIT 1");
    let setup = "unconfigured";
    try { if (configuredDevice()) setup = "configured"; } catch { setup = "invalid"; }
    const lastHardware = publicRecord(recent.get("hardware"));
    const observation = lastHardware && db.prepare("SELECT observed_at FROM paper_observations WHERE id=?").get(lastHardware.id);
    return { setup, lastSimulator: publicRecord(recent.get("simulator")), lastHardware, paperObservedAt: observation?.observed_at ?? null };
  } finally { db.close(); }
}

function writeToSocket(address, bytes) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let attempted = false;
    let settled = false;
    function finish(outcome) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    }
    const failed = () => finish(attempted ? "uncertain" : "not-sent");
    socket.setTimeout(5000, failed);
    socket.once("error", failed);
    socket.once("close", failed);
    socket.connect(address.port, address.host, () => {
      attempted = true;
      socket.end(bytes, () => finish("socket-sent"));
    });
  });
}

async function runCheck(mode, id) {
  if (!testIdPattern.test(id) || !["simulator","hardware"].includes(mode)) throw new Error("Invalid diagnostic mode or test ID.");
  const device = mode === "hardware" ? configuredDevice() : null;
  if (mode === "hardware" && !device) throw new Error("The local printer address has not been configured.");
  const target = device ? `${device.host}:${device.port}` : "file";
  const bytes = specimen(id);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const { db, directory } = openJournal();
  try {
    const find = db.prepare("SELECT * FROM checks WHERE mode=? AND id=?");
    // The committed intent elects a single sender even across concurrent processes.
    const inserted = db.prepare("INSERT OR IGNORE INTO checks VALUES(?,?,?,?,'sending',?,?)")
      .run(mode, id, target, digest, new Date().toISOString(), bytes.toString("ascii"));
    if (!inserted.changes) {
      const existing = find.get(mode, id);
      if (existing.target !== target || existing.digest !== digest) throw new Error("This test ID already identifies a different specimen or device.");
      return publicRecord(existing);
    }
    let outcome;
    if (device) {
      outcome = await writeToSocket(device, bytes);
    } else {
      // Re-open the virtual spool to verify the actual rendered bytes, including feed lines.
      const output = path.join(directory, `test-${id}.prn`);
      try {
        fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600, flush: true });
        outcome = bytes.equals(fs.readFileSync(output)) ? "simulated" : "uncertain";
      } catch { outcome = "uncertain"; }
    }
    db.prepare("UPDATE checks SET outcome=? WHERE mode=? AND id=?").run(outcome, mode, id);
    return publicRecord(find.get(mode, id));
  } finally { db.close(); }
}

function recordPaper(id) {
  if (typeof id !== "string" || !testIdPattern.test(id)) throw new Error("Enter the test ID printed on the physical slip.");
  const { db } = openJournal();
  try {
    const sent = db.prepare("SELECT outcome FROM checks WHERE mode='hardware' AND id=?").get(id);
    if (!sent || sent.outcome === "not-sent") throw new Error("No matching hardware test with possible output was recorded here.");
    db.prepare("INSERT OR IGNORE INTO paper_observations VALUES(?,?)").run(id, new Date().toISOString());
    const row = db.prepare("SELECT observed_at FROM paper_observations WHERE id=?").get(id);
    return { id, evidence: "operator-observed-paper", observedAt: row.observed_at };
  } finally { db.close(); }
}

module.exports = { readStatus, runCheck, writeToSocket, recordPaper };
