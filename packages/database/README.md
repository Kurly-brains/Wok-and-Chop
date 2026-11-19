# Database foundation

`migrations/001_foundation.up.sql` is a development PostgreSQL schema, not an integrated payment ledger. It provides independent state enums; immutable priced revisions; unique provider events and payment IDs; at most one active attempt and one canonical capture per order; original KOT uniqueness; reprint linkage; immutable print payloads; an outbox; operation fingerprints; and append-only audit records.

No application persistence layer, migration runner, authentication, menu management, capacity transaction, acceptance transaction, financial reconciliation or notification store is implemented in this milestone. Up migration, `test-foundation.sql` and down migration passed on an isolated local PostgreSQL 18.3 instance on 18 November 2026. Re-run on the pinned PostgreSQL 17.12 deployment target before deployment. These are constraint tests, not concurrency acceptance. The constraints complement the application rules; they do not replace them.

Apply through a database client with `ON_ERROR_STOP=1`. Migrations are transactional. The down script drops all foundation tables and is only suitable for disposable development databases. Production recovery requires a verified backup and forward-compatible migrations.

Before connecting checkout, implement and integration-test these transactions:

1. Lock quote/configuration and capacity; reserve stock/slot, insert immutable order revision and one CREATING attempt. Commit before calling Stripe with the stored idempotency key.
2. Lock attempt/order/reservation after authoritative provider verification. Assign canonical capture, accept fulfillment or record an exception, commit capacity and write semantic outbox obligations atomically.
3. Lock the capture before reserving refund budget. Include PENDING and SUCCEEDED requests. Never hold the lock during a provider call.
4. Serialize dispatch-start and cancellation; validate current fencing token and ticket-type eligibility. Lease expiry is not permission to resend UNKNOWN work.
5. Allocate display numbers using a locked per-location/business-date sequence, never row counts. Guest references require secure random tokens; sequential display numbers are not credentials.

The deferred active-revision foreign key means an order and revision must be inserted in the same transaction. Cross-record location consistency, actor roles, valid state transitions, canonical flag/link consistency and all sensitive writes must be enforced by the persistence services and their integration tests before access is granted. Dedicated least-privilege database roles are a launch requirement.
