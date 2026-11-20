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
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { AuthService } from "./auth";
import { publishedPricingCatalog } from "./published-menu";
import { enqueueEmail, staffEmail, validEmailAddress } from "./notifications";
import {
  confirmedPickup,
  fields,
  hash,
  pickupInput,
  pickupQuoteInput,
  preparePickupQuote,
  reorderSelections,
  trackingFormat,
  uuid,
} from "./order-input";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type Snapshot = ReturnType<typeof confirmedPickup> & {
  email?: string;
  address?: { street: string; unit: string; city: string; province: string; postalCode: string };
  instructions?: string;
};
const transitions = {
  DELIVERY: {
    RECEIVED: ["PREPARING", "CANCELLED"],
    PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["DELIVERED"],
    DELIVERED: [],
    CANCELLED: [],
  },
  PICKUP: {
    RECEIVED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY_FOR_PICKUP", "CANCELLED"],
    READY_FOR_PICKUP: ["PICKED_UP", "CANCELLED"],
    PICKED_UP: [],
    CANCELLED: [],
  },
} as const;
type Fulfillment = keyof typeof transitions;
type Status = keyof typeof transitions.DELIVERY | keyof typeof transitions.PICKUP;
const knownStatuses = new Set([...Object.keys(transitions.DELIVERY), ...Object.keys(transitions.PICKUP)]);
const numberPrefix = { DELIVERY: "D-", PICKUP: "P-" } as const;
type StatusEvent = { status: Status; at: string };
type Row = {
  id: string;
  order_number: string;
  fulfillment: Fulfillment;
  status: Status;
  version: number;
  created_at: Date;
  updated_at: Date;
  snapshot: Snapshot;
  request_fingerprint: string;
  status_history?: StatusEvent[];
  manager_note?: string;
  archived_at?: Date | null;
  created_by_manager_id?: string | null;
  undo_target_status?: Status | null;
  audit_history?: unknown[];
};
const statusHistory = `(
  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at) ORDER BY e.version), '[]'::jsonb)
  FROM delivery_order_events e WHERE e.order_id=d.id AND e.action IN ('STATUS','UNDO')
) AS status_history`;
const managementHistory = `(
  SELECT CASE WHEN e.action='STATUS' THEN e.previous_status ELSE NULL END
  FROM delivery_order_events e WHERE e.order_id=d.id AND e.action IN ('STATUS','UNDO') ORDER BY e.version DESC LIMIT 1
) AS undo_target_status, (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('version',e.version,'action',e.action,'status',e.status,'previousStatus',e.previous_status,'reason',e.reason,'detail',e.detail,'at',e.created_at,'managerId',e.manager_id) ORDER BY e.version),'[]'::jsonb)
  FROM delivery_order_events e WHERE e.order_id=d.id
) AS audit_history`;

async function managedOrder(db: Pool | PoolClient, id: string) {
  return (await db.query<Row>(`SELECT d.*, ${statusHistory}, ${managementHistory} FROM delivery_orders d WHERE d.id=$1`, [id])).rows[0];
}

const pickupMessages: Partial<Record<Status, string>> = {
  RECEIVED: "We received your pickup order.",
  PREPARING: "The kitchen is preparing your order.",
  READY_FOR_PICKUP: "Your order is ready to collect at Wok & Chop, 790 Kanata Avenue, Unit M2A, Kanata.",
  PICKED_UP: "Your pickup order has been collected.",
  CANCELLED: "Your pickup order was cancelled. Please call (613) 591-1111 if you have questions.",
};

async function queuePickupEmails(db: PoolClient, row: Row, initial: boolean, correction = false) {
  const number = numberPrefix.PICKUP + row.order_number;
  const message = pickupMessages[row.status];
  if (!message) return;
  if (row.snapshot.email && validEmailAddress(row.snapshot.email)) {
    await enqueueEmail(db, {
      to: row.snapshot.email,
      subject: `Wok & Chop pickup ${number} · ${row.status === "READY_FOR_PICKUP" ? "Ready to collect" : "Order update"}`,
      text: `${correction ? "The restaurant corrected your pickup status. " : ""}${message}\n\nOrder ${number}\nUse the private tracking code from your receipt to check the status.`,
    });
  }
  if (initial || row.status === "CANCELLED") {
    await enqueueEmail(db, {
      to: staffEmail,
      subject: `${initial ? "New" : "Cancelled"} Wok & Chop pickup ${number}`,
      text: `${message}\n\n${row.snapshot.lines.map(line => `${line.quantity} × ${line.name}`).join("\n")}\n\nOpen the Wok & Chop staff order desk for details.`,
    });
  }
}

function items(lines: Snapshot["lines"]) {
  return lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    modifiers: line.modifiers.map((m) => m.name),
    lineTotalCents: line.lineTotalCents,
  }));
}
function customerView(row: Row) {
  const {
    subtotalCents,
    discountCents,
    totalCents,
    deliveryCents,
    taxCents,
    lines,
  } = row.snapshot;
  return {
    id: row.id,
    number: numberPrefix[row.fulfillment] + row.order_number,
    fulfillment: row.fulfillment,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusHistory: row.status_history,
    items: items(lines),
    subtotalCents,
    discountCents,
    totalCents,
    deliveryCents,
    taxCents,
  };
}
function managerView(row: Row) {
  const { name, phone, address, instructions, lines } = row.snapshot;
  const receipt = customerView(row);
  return {
    ...receipt,
    name,
    phone,
    address: address ?? null,
    instructions: instructions ?? "",
    managerNote: row.manager_note ?? "",
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at ?? null,
    createdByManager: Boolean(row.created_by_manager_id),
    canUndoStatus: row.fulfillment === "PICKUP" && !row.archived_at && Boolean(row.undo_target_status),
    undoTargetStatus: row.fulfillment === "PICKUP" && !row.archived_at ? row.undo_target_status ?? null : null,
    auditHistory: row.audit_history ?? [],
    items: receipt.items.map((item, index) => ({
      ...item,
      note: lines[index].note,
    })),
  };
}

export async function deliveryPage(
  db: Pool,
  after: unknown,
  accountId: string | null,
  scope: "active" | "history" | "mine" | "archived",
  fulfillment: Fulfillment | null = "DELIVERY",
) {
  if (after !== undefined && (typeof after !== "string" || !uuid.test(after)))
    throw new BadRequestException("Invalid order list cursor.");
  const result = await db.query<Row>(
    `SELECT d.*, ${statusHistory}${scope === "mine" ? "" : `, ${managementHistory}`} FROM delivery_orders d WHERE ($1::uuid IS NULL OR d.customer_account_id=$1)
    AND ($2::uuid IS NULL OR d.order_number < (SELECT c.order_number FROM delivery_orders c WHERE c.id=$2 AND ($1::uuid IS NULL OR c.customer_account_id=$1) AND ($4::text IS NULL OR c.fulfillment=$4)))
    AND ($3::text='mine' OR ($3='archived' AND d.archived_at IS NOT NULL) OR ($3 IN ('active','history') AND d.archived_at IS NULL AND ($3='history') = (d.status IN ('DELIVERED','PICKED_UP','CANCELLED'))))
    AND ($4::text IS NULL OR d.fulfillment=$4)
    ORDER BY d.order_number DESC LIMIT 26`,
    [accountId, after ?? null, scope, fulfillment],
  );
  const records = result.rows.slice(0, 25);
  return {
    deliveries:
      scope === "mine" ? records.map(customerView) : records.map(managerView),
    nextCursor: result.rows.length > 25 ? records[24].id : null,
  };
}

async function trackOrder(db: Pool, body: unknown, fulfillment: Fulfillment) {
  const { trackingToken, number } = fields(body, ["trackingToken", "number"]);
  const numberFormat = fulfillment === "PICKUP" ? /^P-\d{1,19}$/ : /^D-\d{1,19}$/;
  if (typeof trackingToken !== "string" || !trackingFormat.test(trackingToken) ||
    (number !== undefined && (typeof number !== "string" || !numberFormat.test(number)))) {
    throw new BadRequestException("Enter a valid private tracking code and order number.");
  }
  const { rows: [row] } = await db.query<Row>(
    `SELECT d.*, ${statusHistory} FROM delivery_orders d WHERE d.tracking_hash=$1 AND d.fulfillment=$2`,
    [hash(trackingToken), fulfillment],
  );
  if (!row || (number !== undefined && number !== numberPrefix[fulfillment] + row.order_number)) {
    throw new NotFoundException("Order not found. Check your tracking code.");
  }
  return customerView(row);
}

@Controller("v1/auth/deliveries")
export class DeliveryController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("config")
  config() {
    return { enabled: false, postalPrefixes: [] };
  }
  @Post(["", "quote"])
  unavailable(): never {
    throw new ServiceUnavailableException("Delivery orders are placed through Uber Eats.");
  }
  @Post("track")
  @HttpCode(200)
  async track(@Body() body: unknown, @Req() request: Request) {
    this.auth.checkOrigin(request);
    return { delivery: await trackOrder(this.auth.database(), body, "DELIVERY") };
  }
  @Get("mine")
  async mine(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("after") after?: unknown,
  ) {
    const { user } = await this.auth.me(request, response);
    if (!user) throw new UnauthorizedException("Sign in to view your deliveries.");
    const orders = await deliveryPage(this.auth.database(), after, user.id, "mine");
    return { accountId: user.id, ...orders };
  }

  @Get(":id/reorder")
  async reorder(
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user } = await this.auth.me(request, response);
    if (!user) throw new UnauthorizedException("Sign in to reorder a delivery.");
    if (!uuid.test(id)) throw new NotFoundException("Delivery not found.");
    const { rows } = await this.auth.database().query<Pick<Row, "snapshot">>(
      "SELECT snapshot FROM delivery_orders WHERE id=$1 AND customer_account_id=$2 AND fulfillment='DELIVERY'",
      [id, user.id],
    );
    if (!rows[0]) throw new NotFoundException("Delivery not found.");
    return { accountId: user.id, ...reorderSelections(rows[0].snapshot.lines, await publishedPricingCatalog(this.auth.database())) };
  }
}

async function persistPickup(db: Pool, input: ReturnType<typeof pickupInput>, accountId: string | null, managerId: string | null = null) {
    const requestHash = hash("pickup-request-v1:" + input.requestId);
    const fingerprint = hash(
      JSON.stringify([
        accountId,
        input.selection,
        input.contact,
        input.quoteFingerprint,
        input.expectedTotalCents ?? null,
        ...(managerId ? [{ createdByManagerId: managerId }] : []),
      ]),
    );
    const token = hash("pickup-tracking-v1:" + input.requestId);
    const replay = (row: Row) => {
      if (row.request_fingerprint !== fingerprint)
        throw new ConflictException(
          "This request identifier has already been used for a different pickup.",
        );
      return { pickup: customerView(row), trackingToken: token };
    };
    const existing = await db.query<Row>(
      `SELECT d.*, ${statusHistory} FROM delivery_orders d WHERE d.request_hash=$1`,
      [requestHash],
    );
    if (existing.rows[0]) return replay(existing.rows[0]);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialise menu publication against the final price and availability check.
      await client.query("SELECT version FROM shared_preview_menu WHERE singleton FOR SHARE");
      const committed = await client.query<Row>(`SELECT d.*, ${statusHistory} FROM delivery_orders d WHERE d.request_hash=$1`, [requestHash]);
      if (committed.rows[0]) {
        const receipt = replay(committed.rows[0]);
        await client.query("COMMIT");
        return receipt;
      }
      const snapshot = confirmedPickup(input, await publishedPricingCatalog(client));
      const result = await client.query<Row>(
        `INSERT INTO delivery_orders(customer_account_id,request_hash,request_fingerprint,tracking_hash,snapshot,fulfillment,created_by_manager_id)
        VALUES($1,$2,$3,$4,$5,'PICKUP',$6) ON CONFLICT(request_hash) DO NOTHING RETURNING *`,
        [
          accountId,
          requestHash,
          fingerprint,
          hash(token),
          JSON.stringify(snapshot),
          managerId,
        ],
      );
      let row = result.rows[0];
      if (row) {
        await client.query(
          "INSERT INTO delivery_order_events(order_id,version,status,manager_id) VALUES($1,1,'RECEIVED',$2)",
          [row.id, managerId],
        );
        await queuePickupEmails(client, row, true);
      }
      // Return the saved timeline for both a new order and a concurrent replay.
      row = (
        await client.query<Row>(
          `SELECT d.*, ${statusHistory} FROM delivery_orders d WHERE d.request_hash=$1`,
          [requestHash],
        )
      ).rows[0];
      const receipt = replay(row);
      await client.query("COMMIT");
      return receipt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
}

@Controller("v1/auth/pickups")
export class PickupController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("config")
  async config() {
    await this.auth.database().query("SELECT fulfillment FROM delivery_orders LIMIT 0");
    return { enabled: true, mode: "LOCAL_UNPAID", deliveryCents: null, taxCents: null };
  }
  @Post("quote")
  @HttpCode(200)
  async quote(@Body() body: unknown, @Req() request: Request) {
    this.auth.checkOrigin(request);
    const selection = pickupQuoteInput(body);
    const quote = preparePickupQuote(selection, await publishedPricingCatalog(this.auth.database()));
    return {
      ...quote.totals,
      items: items(quote.lines),
      quoteFingerprint: quote.quoteFingerprint,
    };
  }
  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const input = pickupInput(body);
    const { user } = await this.auth.me(request, response);
    const db = this.auth.database();
    const accountId = user?.id ?? null;
    if (input.expectedAccountId !== undefined && input.expectedAccountId !== accountId) {
      throw new ConflictException({
        code: "CHECKOUT_ACCOUNT_CHANGED",
        message: "Your account session changed. Review your pickup again before submitting.",
      });
    }
    return persistPickup(db, input, accountId);
  }
  @Post("track")
  @HttpCode(200)
  async track(@Body() body: unknown, @Req() request: Request) {
    this.auth.checkOrigin(request);
    return { pickup: await trackOrder(this.auth.database(), body, "PICKUP") };
  }
  @Get("mine")
  async mine(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("after") after?: unknown,
  ) {
    const { user } = await this.auth.me(request, response);
    if (!user) throw new UnauthorizedException("Sign in to view your pickups.");
    const { deliveries: pickups, nextCursor } = await deliveryPage(this.auth.database(), after, user.id, "mine", "PICKUP");
    return { accountId: user.id, pickups, nextCursor };
  }
}

@Controller("v1/auth/admin/deliveries")
export class ManagerDeliveryController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get()
  async list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("scope") scope: unknown = "active",
    @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (scope !== "active" && scope !== "history" && scope !== "archived")
      throw new BadRequestException(
        "Choose an active, history, or archived order queue.",
      );
    return deliveryPage(db, after, null, scope, null);
  }
  @Post(":id/status")
  @HttpCode(200)
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    const { expectedVersion, status } = fields(body, [
      "expectedVersion",
      "status",
    ]);
    if (
      !uuid.test(id) ||
      typeof expectedVersion !== "number" ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion >= 2147483647 ||
      typeof status !== "string" ||
      !knownStatuses.has(status)
    )
      throw new BadRequestException("Invalid order status request.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query<Row>(
          "SELECT * FROM delivery_orders WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!current) throw new NotFoundException("Order not found.");
      const allowed = transitions[current.fulfillment] as Partial<Record<Status, readonly string[]>>;
      if (
        current.version !== expectedVersion ||
        current.archived_at ||
        !allowed[current.status]?.includes(status)
      )
        throw new ConflictException(
          "The order has changed or this step is no longer available. Refresh the queue.",
        );
      const updated = (
        await client.query<Row>(
          "UPDATE delivery_orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, status],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO delivery_order_events(order_id,version,status,manager_id,previous_status) VALUES($1,$2,$3,$4,$5)",
        [updated.id, updated.version, status, accountId, current.status],
      );
      if (updated.fulfillment === "PICKUP") await queuePickupEmails(client, updated, false);
      const delivery = managerView(await managedOrder(client, id));
      await client.query("COMMIT");
      return { delivery };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Post(":id/undo")
  @HttpCode(200)
  undo(@Param("id") id: string, @Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.manage(id, body, request, response, "UNDO");
  }

  @Post(":id/archive")
  @HttpCode(200)
  archive(@Param("id") id: string, @Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.manage(id, body, request, response, "ARCHIVE");
  }

  @Post(":id/note")
  @HttpCode(200)
  note(@Param("id") id: string, @Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.manage(id, body, request, response, "NOTE");
  }

  private async manage(id: string, body: unknown, request: Request, response: Response, operation: "UNDO" | "ARCHIVE" | "NOTE") {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(request, response);
    const input = fields(body, ["expectedVersion", operation === "UNDO" ? "reason" : operation === "NOTE" ? "note" : "archived"]);
    if (!uuid.test(id) || typeof input.expectedVersion !== "number" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion >= 2147483647) {
      throw new BadRequestException("Enter a valid order and reviewed version.");
    }
    const text = operation === "NOTE" ? managerText(input.note, 1000, false) : operation === "UNDO" ? managerText(input.reason, 500, true) : "";
    if (operation === "ARCHIVE" && typeof input.archived !== "boolean") throw new BadRequestException("Choose whether to archive or restore this pickup.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = (await client.query<Row>("SELECT * FROM delivery_orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!current || current.fulfillment !== "PICKUP") throw new NotFoundException("Pickup order not found.");
      if (current.version !== input.expectedVersion) throw new ConflictException("The order changed. Refresh it before making another change.");
      let action: "UNDO" | "ARCHIVE" | "RESTORE" | "NOTE" = operation;
      let reason = "";
      let detail: Record<string, unknown> = {};
      let updated: Row;
      if (operation === "UNDO") {
        if (current.archived_at) throw new ConflictException("Restore this pickup before correcting its status.");
        const latest = (await client.query<{action: string; previous_status: Status | null}>(
          "SELECT action,previous_status FROM delivery_order_events WHERE order_id=$1 AND action IN ('STATUS','UNDO') ORDER BY version DESC LIMIT 1", [id],
        )).rows[0];
        if (latest?.action !== "STATUS" || !latest.previous_status || !(latest.previous_status in transitions.PICKUP)) {
          throw new ConflictException("There is no recent status change available to undo.");
        }
        updated = (await client.query<Row>("UPDATE delivery_orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, latest.previous_status])).rows[0];
        reason = text;
      } else if (operation === "NOTE") {
        detail = { previousNote: current.manager_note ?? "", note: text };
        updated = (await client.query<Row>("UPDATE delivery_orders SET manager_note=$2,version=version+1 WHERE id=$1 RETURNING *", [id, text])).rows[0];
      } else {
        if (input.archived && current.status !== "CANCELLED" && current.status !== "PICKED_UP") throw new ConflictException("Only collected or cancelled pickups can be archived.");
        if (Boolean(current.archived_at) === input.archived) {
          const delivery = managerView(await managedOrder(client, id));
          await client.query("COMMIT");
          return { delivery };
        }
        action = input.archived ? "ARCHIVE" : "RESTORE";
        detail = { archived: input.archived };
        updated = (await client.query<Row>("UPDATE delivery_orders SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,version=version+1 WHERE id=$1 RETURNING *", [id, input.archived])).rows[0];
      }
      await client.query("INSERT INTO delivery_order_events(order_id,version,status,manager_id,action,previous_status,reason,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, updated.version, updated.status, accountId, action, operation === "UNDO" ? current.status : null, reason, JSON.stringify(detail)]);
      if (operation === "UNDO") await queuePickupEmails(client, updated, false, true);
      const delivery = managerView(await managedOrder(client, id));
      await client.query("COMMIT");
      return { delivery };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function managerText(value: unknown, maximum: number, required: boolean) {
  if (typeof value !== "string") throw new BadRequestException("Enter a valid manager note or reason.");
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length > maximum || (required && !normalized) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(normalized)) {
    throw new BadRequestException(`Enter ${required ? "1" : "0"}–${maximum} characters without control codes.`);
  }
  return normalized;
}

@Controller("v1/auth/admin/pickups")
export class ManagerPickupController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post()
  async create(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.auth.checkOrigin(request);
    const { pool, accountId } = await this.auth.managerAccess(request, response);
    this.auth.limit(request, "manager-pickup-create");
    const input = pickupInput(body);
    if (input.expectedAccountId !== undefined && input.expectedAccountId !== null) throw new BadRequestException("Staff-created pickups must be guest orders.");
    return persistPickup(pool, input, null, accountId);
  }
}
