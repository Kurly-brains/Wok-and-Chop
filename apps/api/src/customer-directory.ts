import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "./auth";
import { fetchCustomerOrders } from "./customer-orders";
import { deliveryPage } from "./deliveries";

type SessionRequest = Parameters<AuthService["me"]>[0];
type SessionResponse = Parameters<AuthService["me"]>[1];
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const pageSize = 20;

@Controller("v1/auth/admin/customers")
export class CustomerDirectoryController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async list(
    @Req() request: SessionRequest, @Res({ passthrough: true }) response: SessionResponse,
    @Query("q") query?: unknown, @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (query !== undefined && (typeof query !== "string" || query.length > 120)) throw new BadRequestException("Invalid search term.");
    if (after !== undefined && (typeof after !== "string" || !uuid.test(after))) throw new BadRequestException("Invalid directory cursor.");
    const { rows } = await db.query(
      `SELECT a.id, a.display_name AS name, a.email_normalized AS email, a.created_at AS "joinedAt",
              totals.count::integer AS "orderCount", totals.latest AS "lastOrderAt"
         FROM customer_accounts a CROSS JOIN LATERAL (
           SELECT COUNT(*) AS count, MAX(placed_at) AS latest FROM (
             SELECT created_at AS placed_at FROM orders WHERE customer_account_id = a.id
             UNION ALL
             SELECT created_at AS placed_at FROM delivery_orders WHERE customer_account_id = a.id
           ) active_orders
         ) totals
        WHERE (strpos(lower(a.display_name), lower($1)) > 0 OR strpos(a.email_normalized, lower($1)) > 0)
          AND ($2::uuid IS NULL OR (a.created_at, a.id) < (
               SELECT p.created_at, p.id FROM customer_accounts p WHERE p.id = $2))
        ORDER BY a.created_at DESC, a.id DESC LIMIT $3`,
      [typeof query === "string" ? query.trim() : "", after ?? null, pageSize + 1],
    );
    return { customers: rows.slice(0, pageSize), nextCursor: rows.length > pageSize ? rows[pageSize - 1].id : null };
  }

  @Get(":id/orders")
  async history(
    @Req() request: SessionRequest, @Res({ passthrough: true }) response: SessionResponse,
    @Param("id") id: string, @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (!uuid.test(id)) throw new BadRequestException("Invalid account.");
    const account = await db.query("SELECT 1 FROM customer_accounts WHERE id=$1", [id]);
    if (!account.rowCount) throw new NotFoundException("Account no longer available.");
    return fetchCustomerOrders(db, id, after);
  }

  @Get(":id/deliveries")
  async deliveries(
    @Req() request: SessionRequest, @Res({ passthrough: true }) response: SessionResponse,
    @Param("id") id: string, @Query("after") after?: unknown,
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (!uuid.test(id)) throw new BadRequestException("Invalid account.");
    const { rowCount } = await db.query("SELECT 1 FROM customer_accounts WHERE id=$1", [id]);
    if (!rowCount) throw new NotFoundException("Account no longer available.");
    const result = await deliveryPage(db, after, id, "mine");
    return { accountId: id, ...result };
  }
}
