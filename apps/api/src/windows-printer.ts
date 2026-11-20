import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Pool } from "pg";
import { AuthService } from "./auth";
import type { WindowsPrinterAdapter } from "../../print-bridge/windows-printer";
import { renderKitchenTicket } from "../../../packages/printing/src/index";
import type { PricedLine } from "../../../packages/domain/src/types";

export const WINDOWS_PRINTER_ADAPTER = Symbol("WINDOWS_PRINTER_ADAPTER");
type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type Kind = "TEST" | "PICKUP_KITCHEN";
type Job = {
  id: string;
  request_fingerprint: string;
  kind: Kind;
  order_id: string | null;
  order_number: string | null;
  queue_name: string;
  payload_hash: string;
  status: "SENDING" | "SPOOLED" | "FAILED" | "UNKNOWN";
  detail: string;
  created_at: Date;
  updated_at: Date;
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const publicJob = (job: Job) => ({
  id: job.id,
  kind: job.kind,
  orderId: job.order_id,
  orderNumber: job.order_number,
  queueName: job.queue_name,
  payloadHash: job.payload_hash,
  status: job.status,
  detail: job.detail,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

function requestId(body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("requestId" in body) ||
    typeof body.requestId !== "string" ||
    !uuid.test(body.requestId)
  )
    throw new BadRequestException("Supply a printer request ID.");
  return body.requestId.toLowerCase();
}

@Controller("v1/auth/admin/printer")
export class WindowsPrinterController {
  private readonly limits = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WINDOWS_PRINTER_ADAPTER)
    private readonly adapter: WindowsPrinterAdapter,
  ) {}

  private async journal(db: Pool) {
    const {
      rows: [ready],
    } = await db.query(
      "SELECT to_regclass('public.windows_print_jobs') IS NOT NULL AS ready",
    );
    if (!ready.ready)
      throw new ServiceUnavailableException(
        "Windows printer storage is not configured. Apply local migration 013.",
      );
    // An interrupted process cannot establish whether paper emerged. Never redispatch its intent.
    await db.query(
      "UPDATE windows_print_jobs SET status='UNKNOWN', detail='The local process did not record an outcome. Check the queue and paper; this job will not be resent.', updated_at=now() WHERE status='SENDING' AND created_at < now()-interval '2 minutes'",
    );
  }

  @Get()
  async status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { pool } = await this.auth.managerAccess(request, response);
    await this.journal(pool);
    const [status, jobs] = await Promise.all([
      this.adapter.status(),
      pool.query<Job>(
        "SELECT * FROM windows_print_jobs ORDER BY created_at DESC,id DESC LIMIT 15",
      ),
    ]);
    const {
      rows: [{ busy }],
    } = await pool.query<{ busy: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM windows_print_jobs WHERE queue_name=$1 AND status='SENDING') AS busy",
      [status.queueName],
    );
    return {
      ...status,
      ready: status.ready && !busy,
      detail: busy
        ? "A ticket is being sent. Wait for its outcome before sending another."
        : status.detail,
      jobs: jobs.rows.map(publicJob),
    };
  }

  @Post("test")
  @HttpCode(200)
  test(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.dispatch("TEST", null, body, request, response);
  }

  @Post("pickups/:id")
  @HttpCode(200)
  pickup(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!uuid.test(id)) throw new NotFoundException("Pickup not found.");
    return this.dispatch(
      "PICKUP_KITCHEN",
      id.toLowerCase(),
      body,
      request,
      response,
    );
  }

  private async dispatch(
    kind: Kind,
    orderId: string | null,
    body: unknown,
    request: Request,
    response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    const id = requestId(body);
    const fingerprint = digest(JSON.stringify([kind, orderId]));
    const requestHash = digest(`windows-print:${accountId}:${id}`);
    await this.journal(pool);
    const replay = (job: Job) => {
      if (job.request_fingerprint !== fingerprint)
        throw new ConflictException(
          "This printer request ID was used for a different ticket.",
        );
      return { job: publicJob(job) };
    };
    const prior = await pool.query<Job>(
      "SELECT * FROM windows_print_jobs WHERE request_hash=$1",
      [requestHash],
    );
    if (prior.rows[0]) return replay(prior.rows[0]);
    if (orderId) {
      const original = await pool.query<Job>(
        "SELECT * FROM windows_print_jobs WHERE order_id=$1",
        [orderId],
      );
      if (original.rows[0]) return { job: publicJob(original.rows[0]) };
    }
    const now = Date.now();
    for (const [key, limit] of this.limits)
      if (limit.until < now) this.limits.delete(key);
    const limit = this.limits.get(accountId) ?? {
      count: 0,
      until: now + 60_000,
    };
    limit.count++;
    this.limits.set(accountId, limit);
    if (limit.count > 20)
      throw new ConflictException(
        "Too many printer requests. Wait a minute before requesting another ticket.",
      );
    const status = await this.adapter.status();
    if (!status.ready || !status.queueName)
      throw new ServiceUnavailableException(status.detail);
    const client = await pool.connect();
    let job: Job;
    let text: string;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [requestHash],
      );
      const repeated = await client.query<Job>(
        "SELECT * FROM windows_print_jobs WHERE request_hash=$1",
        [requestHash],
      );
      if (repeated.rows[0]) {
        const result = replay(repeated.rows[0]);
        await client.query("COMMIT");
        return result;
      }
      let orderNumber: string | null = null;
      if (orderId) {
        const {
          rows: [order],
        } = await client.query<{
          order_number: string;
          status: string;
          created_at: Date;
          snapshot: { lines: PricedLine[] };
        }>(
          "SELECT order_number,status,created_at,snapshot FROM delivery_orders WHERE id=$1 AND fulfillment='PICKUP' FOR UPDATE",
          [orderId],
        );
        if (!order) throw new NotFoundException("Pickup not found.");
        const existing = await client.query<Job>(
          "SELECT * FROM windows_print_jobs WHERE order_id=$1",
          [orderId],
        );
        if (existing.rows[0]) {
          await client.query("COMMIT");
          return { job: publicJob(existing.rows[0]) };
        }
        if (
          !["RECEIVED", "PREPARING", "READY_FOR_PICKUP"].includes(order.status)
        )
          throw new ConflictException(
            "Cancelled or collected pickups cannot receive an original kitchen ticket.",
          );
        orderNumber = `P-${order.order_number}`;
        const created = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(order.created_at);
        text =
          "UNPAID / CHECK PAYMENT BEFORE HANDOVER\n" +
          renderKitchenTicket({
            schemaVersion: 1,
            ticketType: "ORIGINAL",
            orderNumber,
            station: "Kitchen",
            pickupLabel: `Order received ${created} (Toronto)`,
            lines: order.snapshot.lines.map((line) => ({
              quantity: line.quantity,
              name: line.name,
              modifiers: line.modifiers.map((option) => option.name),
              note: line.note,
            })),
          });
      } else {
        text =
          "WOK & CHOP\nPRINTER TEST / DO NOT PREPARE\n\n1 x Alignment and wrapping check\n+ Synthetic modifier\nNOTE: Check the full ticket is readable.\n\nNo customer order. No payment.\n" +
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Toronto",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date()) +
          " (Toronto)\n";
      }
      const result = await client.query<Job>(
        `INSERT INTO windows_print_jobs(request_hash,request_fingerprint,kind,order_id,order_number,queue_name,payload,payload_hash,status,detail,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENDING','Dispatch intent recorded. Awaiting Windows queue result.',$9) RETURNING *`,
        [
          requestHash,
          fingerprint,
          kind,
          orderId,
          orderNumber,
          status.queueName,
          text,
          digest(text),
          accountId,
        ],
      );
      job = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictException(
          "A ticket is already being sent to this queue. Refresh its status before trying again.",
        );
      throw error;
    } finally {
      client.release();
    }
    // Durable intent is committed before the OS side effect; no database transaction spans printing.
    let outcome;
    try {
      outcome = await this.adapter.send({
        id: job.id,
        queueName: job.queue_name,
        text,
      });
    } catch {
      outcome = {
        status: "UNKNOWN" as const,
        detail:
          "The print outcome is uncertain. Check the queue and paper; this job will not be resent automatically.",
      };
    }
    const recorded = await pool.query<Job>(
      "UPDATE windows_print_jobs SET status=$2,detail=$3,updated_at=now() WHERE id=$1 AND status='SENDING' RETURNING *",
      [job.id, outcome.status, outcome.detail],
    );
    if (!recorded.rows[0])
      return {
        job: publicJob(
          (
            await pool.query<Job>(
              "SELECT * FROM windows_print_jobs WHERE id=$1",
              [job.id],
            )
          ).rows[0],
        ),
      };
    return { job: publicJob(recorded.rows[0]) };
  }
}
