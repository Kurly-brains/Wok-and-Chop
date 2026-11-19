# Background worker boundary — not implemented

There is no running payment, notification, print-dispatch or reconciliation worker in this milestone. No browser action produces a durable production order. This directory reserves the process boundary from the architecture.

Implementation must treat PostgreSQL as the source of durable work. BullMQ/Redis may wake a worker, but a restart or Redis loss must recover pending work from the inbox/outbox and unresolved payment attempts. Every semantic effect needs a unique business key. Provider signature verification and inbox persistence precede acknowledgment; provider amount, currency, account, mode and order association precede acceptance.

Use minute-by-minute recovery sweeps for unprocessed verified events, CREATING/OPEN/PROCESSING attempts, due scheduled releases, eligible orders missing print obligations, refund reconciliation and stale print evidence. Lock and commit business changes with their outbox events, and make remote calls outside database transactions. An out-of-order failed payment must never reverse a verified capture. A second capture creates an associated financial exception without a second original KOT or fulfillment regression.

Required automated evidence: provider timeouts and duplicates, worker and Redis restart, outbox replay, scheduled release after downtime, reservation expiry racing capture, pending refund budget, and recovery of missing logical work. See `docs/IMPLEMENTATION.md` for the complete launch boundary.
