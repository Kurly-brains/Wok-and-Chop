import { BadRequestException, Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import type { Pool } from "pg";
import { AuthService } from "./auth";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type PickupStatus = "RECEIVED" | "PREPARING" | "READY_FOR_PICKUP" | "PICKED_UP" | "CANCELLED";
type OverviewMetrics = { orders: number; completed: number; cancelled: number; completedFoodTotalCents: number | null; averageCompletedValueCents: number | null };
export type StaffOverview = {
  timezone: "America/Toronto"; currency: "CAD"; fulfillment: "PICKUP"; days: 1 | 7 | 30; asOf: string; currentWindowPartial: true;
  range: { startDate: string; endDate: string }; previousRange: { startDate: string; endDate: string };
  metrics: { current: OverviewMetrics; previous: OverviewMetrics };
  trend: { granularity: "hour" | "day"; periods: { startAt: string; endAt: string; label: string; orders: number; completed: number; completedFoodTotalCents: number | null }[] };
  queue: { total: number; byStatus: Record<"RECEIVED" | "PREPARING" | "READY_FOR_PICKUP", number> };
  statusTotals: Record<PickupStatus, number>;
  topDishes: { itemId: string; name: string; quantity: number; completedOrders: number }[];
  recentPickups: { id: string; number: string; status: PickupStatus; version: number; createdAt: string; totalCents: number | null; itemCount: number; archived: boolean }[];
};

// Both comparisons describe orders created in their calendar window, classified by
// their current status. Archiving hides an order from the desk, never from history.
const metrics = `
  count(o.id)::int AS orders,
  count(o.id) FILTER (WHERE o.status='PICKED_UP')::int AS completed,
  count(o.id) FILTER (WHERE o.status='CANCELLED')::int AS cancelled,
  CASE WHEN count(o.id) FILTER (WHERE o.status='PICKED_UP' AND o.food_total IS NULL)>0
    OR coalesce(sum(o.food_total) FILTER (WHERE o.status='PICKED_UP'),0)>9007199254740991 THEN NULL
    ELSE coalesce(sum(o.food_total) FILTER (WHERE o.status='PICKED_UP'),0) END AS "completedFoodTotalCents",
  CASE WHEN count(o.id) FILTER (WHERE o.status='PICKED_UP' AND o.food_total IS NULL)>0 THEN NULL
    ELSE round(avg(o.food_total) FILTER (WHERE o.status='PICKED_UP')) END AS "averageCompletedValueCents"`;

/** Optional clock is an internal deterministic test seam, never an HTTP input. */
export async function queryStaffOverview(db: Pick<Pool, "query">, days: 1 | 7 | 30, clock?: Date) {
  const { rows: [row] } = await db.query<{ report: StaffOverview }>(`
    WITH instant AS (SELECT coalesce($2::timestamptz,CURRENT_TIMESTAMP) AS as_of),
    calendar AS (
      SELECT as_of, (as_of AT TIME ZONE 'America/Toronto')::date AS today FROM instant
    ), bounds AS (
      SELECT *, today-($1::int-1) AS first_day,
        (today-($1::int-1))::timestamp AT TIME ZONE 'America/Toronto' AS current_start,
        (today-($1::int*2-1))::timestamp AT TIME ZONE 'America/Toronto' AS previous_start,
        (today+1)::timestamp AT TIME ZONE 'America/Toronto' AS current_end
      FROM calendar
    ), orders AS (
      SELECT d.id,d.order_number,d.status,d.version,d.created_at,d.archived_at,d.snapshot,
        CASE WHEN jsonb_typeof(d.snapshot->'totalCents')='number'
          AND d.snapshot->>'totalCents' ~ '^[0-9]{1,12}$'
          THEN (d.snapshot->>'totalCents')::numeric ELSE NULL END AS food_total
      FROM delivery_orders d,bounds b
      WHERE d.fulfillment='PICKUP' AND d.created_at<=b.as_of
        AND (d.created_at>=b.previous_start OR (d.archived_at IS NULL AND d.status IN ('RECEIVED','PREPARING','READY_FOR_PICKUP')))
    ), windows AS (
      SELECT 'current' AS name,current_start AS start_at,current_end AS end_at FROM bounds
      UNION ALL SELECT 'previous',previous_start,current_start FROM bounds
    ), summaries AS (
      SELECT w.name,${metrics} FROM windows w LEFT JOIN orders o ON o.created_at>=w.start_at AND o.created_at<w.end_at GROUP BY w.name
    ), periods AS (
      SELECT h AS start_at,h+interval '1 hour' AS end_at,to_char(h AT TIME ZONE 'America/Toronto','HH24:MI') AS label
      FROM bounds b CROSS JOIN LATERAL generate_series(b.current_start,b.current_end-interval '1 hour',interval '1 hour') h WHERE $1::int=1
      UNION ALL
      SELECT (b.first_day+n)::timestamp AT TIME ZONE 'America/Toronto',
        (b.first_day+n+1)::timestamp AT TIME ZONE 'America/Toronto',to_char(b.first_day+n,'YYYY-MM-DD')
      FROM bounds b CROSS JOIN LATERAL generate_series(0,$1::int-1) n WHERE $1::int<>1
    ), trend AS (
      SELECT p.start_at AS "startAt",p.end_at AS "endAt",p.label,${metrics}
      FROM periods p LEFT JOIN orders o ON o.created_at>=p.start_at AND o.created_at<p.end_at GROUP BY p.start_at,p.end_at,p.label
    ), current_orders AS (
      SELECT o.* FROM orders o,bounds b WHERE o.created_at>=b.current_start AND o.created_at<b.current_end
    ), dish_lines AS (
      SELECT o.id,o.status,o.created_at,item->>'itemId' AS item_id,item->>'name' AS name,
        CASE WHEN jsonb_typeof(item->'quantity')='number' AND item->>'quantity' ~ '^[1-9][0-9]{0,8}$'
          THEN (item->>'quantity')::int ELSE NULL END AS quantity
      FROM current_orders o CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.snapshot->'lines')='array' THEN o.snapshot->'lines' ELSE '[]'::jsonb END
      ) item
    ), dish_totals AS (
      SELECT item_id AS "itemId",(array_agg(name ORDER BY created_at DESC,id DESC))[1] AS name,
        sum(quantity) AS quantity,count(DISTINCT id)::int AS "completedOrders"
      FROM dish_lines WHERE status='PICKED_UP' AND item_id IS NOT NULL AND name IS NOT NULL AND quantity IS NOT NULL
      GROUP BY item_id ORDER BY quantity DESC,"itemId" LIMIT 5
    ), recent AS (
      SELECT o.id,'P-'||o.order_number AS number,o.status,o.version,o.created_at AS "createdAt",o.food_total AS "totalCents",
        (SELECT coalesce(sum(l.quantity),0) FROM dish_lines l WHERE l.id=o.id) AS "itemCount",o.archived_at IS NOT NULL AS archived
      FROM current_orders o ORDER BY o.created_at DESC,o.order_number DESC LIMIT 8
    ), status_totals AS (
      SELECT jsonb_object_agg(s.status,(SELECT count(*) FROM current_orders o WHERE o.status=s.status)) AS totals
      FROM (VALUES ('RECEIVED'),('PREPARING'),('READY_FOR_PICKUP'),('PICKED_UP'),('CANCELLED')) s(status)
    ), queue_statuses AS (
      SELECT s.status,(SELECT count(*) FROM orders o WHERE o.status=s.status AND o.archived_at IS NULL) AS count
      FROM (VALUES ('RECEIVED'),('PREPARING'),('READY_FOR_PICKUP')) s(status)
    )
    SELECT jsonb_build_object(
      'timezone','America/Toronto','currency','CAD','fulfillment','PICKUP','days',$1::int,'asOf',b.as_of,'currentWindowPartial',true,
      'range',jsonb_build_object('startDate',to_char(b.first_day,'YYYY-MM-DD'),'endDate',to_char(b.today,'YYYY-MM-DD')),
      'previousRange',jsonb_build_object('startDate',to_char(b.first_day-$1::int,'YYYY-MM-DD'),'endDate',to_char(b.first_day-1,'YYYY-MM-DD')),
      'metrics',(SELECT jsonb_object_agg(s.name,to_jsonb(s)-'name') FROM summaries s),
      'trend',jsonb_build_object('granularity',CASE WHEN $1::int=1 THEN 'hour' ELSE 'day' END,
        'periods',(SELECT coalesce(jsonb_agg(to_jsonb(t)-'cancelled'-'averageCompletedValueCents' ORDER BY t."startAt"),'[]') FROM trend t)),
      'queue',jsonb_build_object('total',(SELECT sum(count) FROM queue_statuses),'byStatus',(SELECT jsonb_object_agg(status,count) FROM queue_statuses)),
      'statusTotals',(SELECT totals FROM status_totals),
      'topDishes',(SELECT coalesce(jsonb_agg(d ORDER BY quantity DESC,"itemId"),'[]') FROM dish_totals d),
      'recentPickups',(SELECT coalesce(jsonb_agg(r ORDER BY r."createdAt" DESC,r.id DESC),'[]') FROM recent r)
    ) AS report FROM bounds b`, [days, clock ?? null]);
  return row.report;
}

@Controller("v1/auth/admin/overview")
export class StaffOverviewController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async overview(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Query("days") days: unknown = "7") {
    const db = await this.auth.managerDatabase(request, response);
    if (days !== "1" && days !== "7" && days !== "30") throw new BadRequestException("Choose a 1-day, 7-day, or 30-day overview.");
    return queryStaffOverview(db, Number(days) as 1 | 7 | 30);
  }
}
