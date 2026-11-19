import { Body, Controller, Get, Header, Headers, HttpCode, HttpException, Inject, Param, Post } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyTrainingCommand, seedTrainingAt, type DemoService } from "../../../packages/domain/src/training";
import { DomainError } from "../../../packages/domain/src/pricing";
import { renderKitchenTicket } from "../../../packages/printing/src/index";

export class TrainingBoard {
  private connection?: DatabaseSync;

  constructor(
    readonly origin: string,
    private readonly databasePath = join(homedir(), ".wok-and-chop", "training", "operations.sqlite"),
  ) {}

  private database() {
    if (this.connection) return this.connection;
    if (this.databasePath !== ":memory:") mkdirSync(dirname(this.databasePath), { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK(id = 1), snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS training_slips (
          job_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL,
          copy_number INTEGER NOT NULL, issued_at TEXT NOT NULL, payload TEXT NOT NULL,
          UNIQUE(order_id, kind, copy_number)
        );`);
      db.prepare("INSERT OR IGNORE INTO board VALUES (1, ?)").run(JSON.stringify(seedTrainingAt(Date.now())));
    } catch (error) { db.close(); throw error; }
    this.connection = db;
    return db;
  }

  current(): DemoService {
    const row = this.database().prepare("SELECT snapshot FROM board WHERE id = 1").get()!;
    return JSON.parse(String(row.snapshot));
  }

  slip(jobId: string): string {
    const row = this.database().prepare("SELECT payload FROM training_slips WHERE job_id = ?").get(jobId);
    if (!row) throw new HttpException("There is no saved slip for this ticket.", 404);
    return String(row.payload);
  }

  apply(id: string, command: unknown) {
    const db = this.database();
    const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT digest FROM commands WHERE id = ?").get(id);
      if (prior && prior.digest !== digest) throw new HttpException("This request ID already belongs to another action.", 409);
      const current = this.current();
      const state = prior ? current : applyTrainingCommand(current, command, id, new Date().toISOString());
      if (!prior) {
        if (command && typeof command === "object" && "type" in command && (command.type === "create" || command.type === "reprint")) {
          const order = state.orders.find(ticket => ticket.events.at(-1)?.id === id)!;
          const job = order.jobs.at(-1)!;
          const due = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(order.dueAt));
          const payload = renderKitchenTicket({
            schemaVersion: 1, training: true, orderNumber: order.id, ticketType: job.kind, copyNumber: job.copy,
            pickupLabel: due, station: "Main station", lines: order.items, allergyNote: order.allergy, kitchenNote: order.note,
          });
          db.prepare("INSERT INTO training_slips (job_id, order_id, kind, copy_number, issued_at, payload) VALUES (?, ?, ?, ?, ?, ?)").run(job.id, order.id, job.kind, job.copy, job.at, payload);
          job.status = "SPOOLED";
        }
        db.prepare("UPDATE board SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
        db.prepare("INSERT INTO commands VALUES (?, ?)").run(id, digest);
      }
      db.exec("COMMIT");
      return state;
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof DomainError) throw new HttpException(error.message, error.code === "TICKET_CONFLICT" ? 409 : 400);
      throw error;
    }
  }

  onApplicationShutdown() { this.connection?.close(); this.connection = undefined; }
}

@Controller("v1/training/operations")
export class TrainingController {
  constructor(@Inject(TrainingBoard) private readonly board: TrainingBoard) {}

  @Get()
  current() { return this.board.current(); }

  @Get("slips/:jobId") @Header("Content-Type", "text/plain; charset=utf-8")
  slip(@Param("jobId") jobId: string) { return this.board.slip(jobId); }

  @Post("commands") @HttpCode(200)
  command(@Headers("origin") origin: string | undefined, @Headers("content-type") contentType: string | undefined, @Body() body: unknown) {
    if (origin !== this.board.origin) throw new HttpException("Use the configured training workspace.", 403);
    if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpException("Use JSON for training commands.", 415);
    if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id) ||
        !("command" in body) || !body.command || typeof body.command !== "object") throw new HttpException("Invalid training command.", 400);
    return this.board.apply(body.id, body.command);
  }
}
