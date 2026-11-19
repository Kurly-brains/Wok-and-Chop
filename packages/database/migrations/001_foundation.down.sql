-- Destructive: for an empty development database only. Back up before reversal.
BEGIN;
ALTER TABLE orders DROP CONSTRAINT orders_canonical_payment_fk;
ALTER TABLE orders DROP CONSTRAINT orders_active_revision_fk;
DROP TABLE audit_events, print_attempts, print_jobs, refunds, outbox_events,
  webhook_inbox, operation_keys, reservations, capacity_slots, captures,
  payment_attempts, order_revisions, orders, locations;
DROP FUNCTION preserve_print_identity();
DROP FUNCTION reject_immutable_update();
DROP TYPE print_state, refund_state, attempt_state, fulfillment_state, payment_state;
COMMIT;
