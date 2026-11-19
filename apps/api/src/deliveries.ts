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
  UnauthorizedException,
} from "@nestjs/common";
import type { Pool } from "pg";
import { AuthService } from "./auth";
import {
  confirmedSnapshot,
  fields,
  hash,
  orderInput,
  postalPrefixes,
  prepareQuote,
  quoteInput,
  trackingFormat,
  uuid,
} from "./delivery-input";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type Snapshot = ReturnType<typeof confirmedSnapshot>;
const transitions = {
  RECEIVED: ["PREPARING", "CANCELLED"],
  PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
} as const;
type Status = keyof typeof transitions;
type Row = {
  id: string;
  order_number: string;
  status: Status;
  version: number;
  created_at: Date;
  updated_at: Date;
  snapshot: Snapshot;
  request_fingerprint: string;
};
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
    number: `D-${row.order_number}`,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    address,
    instructions,
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
  scope: "active" | "history" | "mine",
) {
  if (after !== undefined && (typeof after !== "string" || !uuid.test(after)))
    throw new BadRequestException("Invalid delivery list cursor.");
  const result = await db.query<Row>(
    `SELECT d.* FROM delivery_orders d WHERE ($1::uuid IS NULL OR d.customer_account_id=$1)
    AND ($2::uuid IS NULL OR d.order_number < (SELECT c.order_number FROM delivery_orders c WHERE c.id=$2 AND ($1::uuid IS NULL OR c.customer_account_id=$1)))
    AND ($3::text='mine' OR ($3='history') = (d.status IN ('DELIVERED','CANCELLED')))
    ORDER BY d.order_number DESC LIMIT 26`,
    [accountId, after ?? null, scope],
  );
  const records = result.rows.slice(0, 25);
  return {
    deliveries:
      scope === "mine" ? records.map(customerView) : records.map(managerView),
    nextCursor: result.rows.length > 25 ? records[24].id : null,
  };
}

@Controller("v1/auth/deliveries")
export class DeliveryController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get("config")
  async config() {
    await this.auth.database().query("SELECT id FROM delivery_orders LIMIT 0");
    return {
      enabled: true,
      mode: "LOCAL_UNPAID",
      province: "ON",
      postalPrefixes: postalPrefixes(),
      deliveryCents: null,
      taxCents: null,
    };
  }
  @Post("quote")
  @HttpCode(200)
  quote(@Body() body: unknown, @Req() request: Request) {
    this.auth.checkOrigin(request);
    const quote = prepareQuote(quoteInput(body));
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
    const input = orderInput(body);
    const { user } = await this.auth.me(request, response);
    const db = this.auth.database();
    const accountId = user?.id ?? null;
    const requestHash = hash(input.requestId);
    const fingerprint = hash(
      JSON.stringify([
        accountId,
        input.selection,
        input.contact,
        input.quoteFingerprint,
        input.expectedTotalCents ?? null,
      ]),
    );
    const token = hash("delivery-tracking-v1:" + input.requestId);
    const replay = (row: Row) => {
      if (row.request_fingerprint !== fingerprint)
        throw new ConflictException(
          "This request identifier has already been used for a different delivery.",
        );
      return { delivery: customerView(row), trackingToken: token };
    };
    const existing = await db.query<Row>(
      "SELECT * FROM delivery_orders WHERE request_hash=$1",
      [requestHash],
    );
    if (existing.rows[0]) return replay(existing.rows[0]);
    const snapshot = confirmedSnapshot(input);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row>(
        `INSERT INTO delivery_orders(customer_account_id,request_hash,request_fingerprint,tracking_hash,snapshot)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_hash) DO NOTHING RETURNING *`,
        [
          accountId,
          requestHash,
          fingerprint,
          hash(token),
          JSON.stringify(snapshot),
        ],
      );
      let row = result.rows[0];
      if (row)
        await client.query(
          "INSERT INTO delivery_order_events(order_id,version,status) VALUES($1,1,'RECEIVED')",
          [row.id],
        );
      else
        row = (
          await client.query<Row>(
            "SELECT * FROM delivery_orders WHERE request_hash=$1",
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
  @Post("track")
  @HttpCode(200)
  async track(@Body() body: unknown, @Req() request: Request) {
    this.auth.checkOrigin(request);
    const { trackingToken, number } = fields(body, ["trackingToken", "number"]);
    if (
      typeof trackingToken !== "string" ||
      !trackingFormat.test(trackingToken) ||
      (number !== undefined &&
        (typeof number !== "string" || !/^D-\d{1,19}$/.test(number)))
    )
      throw new BadRequestException(
        "Enter a valid private tracking code and delivery number.",
      );
    const { rows } = await this.auth
      .database()
      .query<Row>("SELECT * FROM delivery_orders WHERE tracking_hash=$1", [
        hash(trackingToken),
      ]);
    if (
      !rows[0] ||
      (number !== undefined && number !== `D-${rows[0].order_number}`)
    )
      throw new NotFoundException(
        "Delivery not found. Check your tracking code.",
      );
    return { delivery: customerView(rows[0]) };
  }
  @Get("mine")
  async mine(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("after") after?: unknown,
  ) {
    const { user } = await this.auth.me(request, response);
    if (!user)
      throw new UnauthorizedException("Sign in to view your deliveries.");
    const orders = await deliveryPage(this.auth.database(), after, user.id, "mine");
    return { accountId: user.id, ...orders };
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
    if (scope !== "active" && scope !== "history")
      throw new BadRequestException(
        "Choose an active or history delivery queue.",
      );
    return deliveryPage(db, after, null, scope);
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
      typeof status !== "string" ||
      !Object.hasOwn(transitions, status)
    )
      throw new BadRequestException("Invalid delivery status request.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query<Row>(
          "SELECT * FROM delivery_orders WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!current) throw new NotFoundException("Delivery not found.");
      if (
        current.version !== expectedVersion ||
        !(transitions[current.status] as readonly string[]).includes(status)
      )
        throw new ConflictException(
          "The delivery has changed or this step is no longer available. Refresh the queue.",
        );
      const updated = (
        await client.query<Row>(
          "UPDATE delivery_orders SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, status],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO delivery_order_events(order_id,version,status,manager_id) VALUES($1,$2,$3,$4)",
        [updated.id, updated.version, status, accountId],
      );
      await client.query("COMMIT");
      return { delivery: managerView(updated) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
