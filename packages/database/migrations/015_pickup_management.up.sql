BEGIN;
SELECT pg_advisory_xact_lock(18315,15);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS manager_note text NOT NULL DEFAULT '' CHECK (length(manager_note) <= 1000);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS created_by_manager_id uuid REFERENCES customer_accounts(id) ON DELETE SET NULL;
ALTER TABLE delivery_order_events ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'STATUS' CHECK (action IN ('STATUS','UNDO','NOTE','ARCHIVE','RESTORE'));
ALTER TABLE delivery_order_events ADD COLUMN IF NOT EXISTS previous_status text;
ALTER TABLE delivery_order_events ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000);
ALTER TABLE delivery_order_events ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object');
WITH previous AS (
  SELECT order_id,version,lag(status) OVER (PARTITION BY order_id ORDER BY version) AS status
  FROM delivery_order_events WHERE action='STATUS'
) UPDATE delivery_order_events e SET previous_status=p.status FROM previous p
  WHERE e.order_id=p.order_id AND e.version=p.version AND e.previous_status IS NULL;
CREATE INDEX IF NOT EXISTS delivery_orders_archived ON delivery_orders(order_number DESC) WHERE archived_at IS NOT NULL;
COMMIT;
