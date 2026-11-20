import { BadRequestException, Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "./auth";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];

@Controller("v1/auth/admin/delivery-reports")
export class DeliveryReportsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async getReport(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("days") days: unknown = "7",
  ) {
    const db = await this.auth.managerDatabase(request, response);
    if (days !== "7" && days !== "30") {
      throw new BadRequestException("Choose a 7-day or 30-day reporting period.");
    }
    const { rows: [report] } = await db.query(
      `WITH period AS (
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Toronto')::date AS last_day
      ), requests AS (
        SELECT id, status, created_at, snapshot
        FROM delivery_orders, period
        WHERE fulfillment = 'DELIVERY'
          AND created_at >= ((last_day - ($1::int - 1))::timestamp AT TIME ZONE 'America/Toronto')
      ), delivered AS (
        SELECT * FROM requests WHERE status = 'DELIVERED'
      ), timing AS (
        SELECT d.id, min(e.created_at) FILTER (WHERE e.status = 'PREPARING') AS started,
          min(e.created_at) FILTER (WHERE e.status = 'OUT_FOR_DELIVERY') AS dispatched,
          min(e.created_at) FILTER (WHERE e.status = 'DELIVERED') AS finished
        FROM delivered d JOIN delivery_order_events e ON e.order_id = d.id
        GROUP BY d.id
      ), dishes AS (
        SELECT item->>'name' AS name, sum((item->>'quantity')::int) AS quantity
        FROM delivered, jsonb_array_elements(snapshot->'lines') AS item
        GROUP BY name ORDER BY quantity DESC, name LIMIT 5
      ), hours AS (
        SELECT extract(hour FROM created_at AT TIME ZONE 'America/Toronto')::int AS hour,
          count(*) AS requests
        FROM requests GROUP BY hour ORDER BY requests DESC, hour LIMIT 5
      ), promos AS (
        SELECT snapshot->>'promoCode' AS code, count(*) AS redemptions,
          sum((snapshot->>'discountCents')::int) AS "discountCents"
        FROM delivered
        WHERE (snapshot->>'discountCents')::int > 0
        GROUP BY code ORDER BY redemptions DESC, code
      )
      SELECT
        (SELECT to_char(last_day - ($1::int - 1), 'YYYY-MM-DD') FROM period) AS "startDate",
        (SELECT to_char(last_day, 'YYYY-MM-DD') FROM period) AS "endDate",
        (SELECT count(*)::int FROM requests) AS requests,
        (SELECT count(*)::int FROM delivered) AS delivered,
        (SELECT count(*)::int FROM requests WHERE status = 'CANCELLED') AS cancelled,
        (SELECT coalesce(sum((snapshot->>'totalCents')::int), 0)::float8 FROM delivered) AS "foodTotalCents",
        (SELECT round(avg(extract(epoch FROM dispatched - started)) / 60, 1)::float8 FROM timing) AS "prepMinutes",
        (SELECT round(avg(extract(epoch FROM finished - dispatched)) / 60, 1)::float8 FROM timing) AS "deliveryMinutes",
        (SELECT coalesce(jsonb_agg(dishes ORDER BY quantity DESC, name), '[]') FROM dishes) AS dishes,
        (SELECT coalesce(jsonb_agg(hours ORDER BY requests DESC, hour), '[]') FROM hours) AS hours,
        (SELECT coalesce(jsonb_agg(promos ORDER BY redemptions DESC, code), '[]') FROM promos) AS promos`,
      [Number(days)],
    );
    return report;
  }
}
