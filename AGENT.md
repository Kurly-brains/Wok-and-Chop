# Wok & Chop — Engineering Agent Instructions

**Document version:** 1.0  
**Date:** 18 November 2026  
**Status:** Proposed implementation instructions; the application has not yet been built.  
**Scope:** The Wok & Chop online ordering website, restaurant console, kitchen display, payment integration, background workers, and local print bridge.

## 1. Purpose and document use

Build a dependable restaurant ordering system for **Wok & Chop**, a Halal Hakka Chinese restaurant at **790 Kanata Ave, Unit M2A, Kanata ON**. The principal outcome is that an eligible paid order becomes a visible restaurant order and an automatically dispatched kitchen order ticket (KOT), with recoverable failures and an auditable history.

Read these documents before changing the relevant subsystem:

| Document | Responsibility |
| --- | --- |
| [PRD.md](PRD.md) | Product outcomes, customer experience, business scope, and launch decisions |
| [SRS.md](SRS.md) | Numbered, testable functional and nonfunctional requirements |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical boundaries, data, interfaces, concurrency, and operational design |
| [ARCHITECTURE-ESSENTIALS.md](ARCHITECTURE-ESSENTIALS.md) | Short architectural orientation; does not replace the full architecture |
| [AGENT.md](AGENT.md) | Implementation workflow and engineering constraints |

Current explicit owner instructions take precedence over this proposed baseline. Record accepted scope changes in the affected documents. Within the baseline, the PRD owns product intent, the SRS owns observable requirements, and the architecture owns implementation decisions. Resolve conflicts visibly; do not silently select the easiest interpretation. Preserve payment and data integrity while resolving ambiguity.

This filename is intentionally **AGENT.md**, as requested. At repository setup, check the automation runner's instruction discovery convention. If it requires **AGENTS.md**, copy or merge these instructions into that recognized file and define how both remain synchronized. Do not assume every runner reads AGENT.md automatically.

## 2. Baseline and boundaries

Phase 1 is one restaurant location, guest-first ordering, ASAP pickup, scheduled pickup, CAD payments through Stripe-hosted Checkout, staff order management, a kitchen display system (KDS), and automatic thermal KOT printing. Cards and eligible wallets are the initial payment methods. Delivery stays disabled until its operating rules and implementation are explicitly added. Loyalty, marketplaces, full inventory purchasing, payroll, and a complete replacement point-of-sale system are outside this baseline.

Use **America/Toronto** for restaurant business time. Store instants in UTC and retain the relevant timezone and scheduling snapshots. Do not use the developer workstation timezone for pickup promises, reports, or business dates.

The restaurant description and halal positioning were supplied by the owner. Do not invent certifications, supplier assurances, menu items, prices, hours, telephone numbers, or an allergy-free guarantee. Placeholder content must be clearly identified and must not become production restaurant data.

## 3. Proposed repository organization

Use a TypeScript monorepo with these boundaries. This is a proposed layout, not a claim that the directories already exist.

| Path | Ownership |
| --- | --- |
| `apps/web/` | Next.js customer storefront, staff console, and KDS presentation |
| `apps/api/` | NestJS REST endpoints, authorization, application commands, webhook ingress |
| `apps/worker/` | Payment processing, outbox dispatch, notifications, scheduling, reconciliation |
| `apps/print-bridge/` | Linux service, outbound API polling, SQLite journal, printer adapters |
| `packages/domain/` | Money calculations, transition rules, availability and capacity rules |
| `packages/contracts/` | Validated request/response schemas and versioned event contracts |
| `packages/database/` | PostgreSQL migrations, persistence, transaction helpers |
| `packages/observability/` | Structured logs, metrics, tracing, redaction |
| `packages/printing/` | Canonical ticket payloads, safe rendering, printer interface definitions |
| `tests/` | Integration, concurrency, end-to-end, failure, and hardware qualification cases |
| `ops/` | Deployment configuration, backup verification, monitoring, runbooks |
| `docs/` | Product and technical documents, decisions, operator instructions |

Select supported framework, runtime, database, and SDK versions during implementation; pin them and commit the lockfile. Do not label a remembered version as “latest.” Use a single package manager consistently. Keep business decisions out of React components and printer drivers. Shared domain code must not depend on browser APIs or a live Stripe connection.

PostgreSQL is the authoritative system of record. Redis/BullMQ supplies execution notifications and scheduling acceleration; losing Redis must not lose paid orders or print obligations. The bridge's SQLite journal preserves local dispatch evidence across process restarts.

## 4. Non-negotiable payment and order invariants

1. Calculate prices, modifiers, discounts, taxes, charges, and tips on the server. Accept customer selections, never customer-calculated totals as authority.
2. Represent money as integer CAD cents. Define and test rounding and allocation rules; use appropriate exact arithmetic for rates.
3. Freeze a priced order snapshot before Checkout. A later menu edit must not rewrite a paid order, receipt, or refund basis.
4. The Checkout success URL is a presentation destination. It cannot mark an order paid or release a KOT.
5. Verify Stripe webhook signatures against the unmodified raw request body. Acknowledge only after durable event persistence; process business effects asynchronously.
6. Deduplicate both event IDs and business effects. Different event IDs may describe the same successful payment.
7. Persist acceptance, canonical payment linkage, and its outbox events atomically. Print and notification workers consume durable obligations.
8. Allow one active Checkout attempt per order by database enforcement. A session-creation timeout leaves that attempt in `CREATING` with its original idempotency key; recover the same request rather than creating another payment session.
9. An earlier failed attempt cannot reverse a paid order. A duplicate extra successful payment creates a financial exception for resolution, never a second production ticket or regression of the canonical order's existing kitchen progress.
10. Late payment without a valid fulfillment reservation goes to `EXCEPTION`; staff resolve fulfillment or refund before unattended cooking proceeds. Verified captures still create a truthful payment-received receipt, without implying the restaurant accepted an invalid pickup promise.

Use request idempotency keys for Checkout creation, refunds, and reprints. Store the request fingerprint and result; reject reuse with a different payload. Provider idempotency and local uniqueness are complementary. Neither replaces the other.

## 5. Preserve independent state machines

| Axis | States in the proposed baseline |
| --- | --- |
| Payment aggregate | `UNPAID`, `PROCESSING`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`, `FAILED` |
| Refund request | `PENDING`, `SUCCEEDED`, `FAILED` |
| Fulfillment | `AWAITING_PAYMENT`, `ACCEPTED`, `SCHEDULED`, `IN_PREPARATION`, `READY`, `COMPLETED`, `CANCELLED`, `EXCEPTION` |
| Print job | `QUEUED`, `LEASED`, `SENDING`, `DELIVERED`, `CONFIRMED`, `RETRY_WAIT`, `UNKNOWN`, `FAILED`, `CANCELLED` |

Validate every transition in application/domain code and enforce critical uniqueness in PostgreSQL. Lock or use guarded version checks when concurrent requests can change the same order, reservation, payment, refund, or print job.

Refund submission does not mean refund success. Under a lock, keep successful refunds plus pending refund reservations plus the new request within the original captured amount. Fulfillment cancellation does not prove money has returned to the customer. A financial refund does not silently alter kitchen preparation. Retain explicit financial and kitchen events, with actor and reason. Do not expose one vague “order status” as a substitute for these separate concerns.

Scheduled orders release their production KOT at the stored preparation release time. An optional immediate summary must clearly say HOLD and must not trigger preparation. A scheduled job restored after downtime must be checked for current fulfillment eligibility before release.

Calculate ASAP preparation estimates from verified payment acceptance, not from the time the customer first opened their cart. Offer a scheduled slot only when the complete 30-minute Checkout window fits before its preparation cutoff. Reconcile payment state before expiring or replacing reservations and attempts.

## 6. Thermal printing rules

Use an always-on local Linux bridge with outbound authenticated HTTPS, a qualified wired 80 mm thermal printer, and a tested ESC/POS or vendor SDK adapter. Do not depend on `window.print()`, a staff browser remaining open, public printer ports, or undocumented silent printing. A native CloudPRNT adapter is an alternative only after explicit hardware and protocol qualification.

Create one original production KOT per order revision, station, and ticket type. Give every job a stable ID and immutable payload hash. A bridge lease must include a fencing/version token and server dispatch gate so an expired claimant cannot begin a new send or overwrite newer cloud state. A `LEASED` timeout is safe to retry only when the server gate and durable local journal establish that sending did not begin; loss after `SENDING` becomes `UNKNOWN`. The journal must identify jobs already dispatched or unresolved before any retry after reboot.

Record intent before printer dispatch and persist its outcome afterward. A definite failure before any output is possible may retry the same job. If the printer might have produced paper and the acknowledgment is missing, mark the job `UNKNOWN`, alert staff, and stop automatic resend. A socket accepting bytes establishes transport delivery, not proof of completed physical printing. Reserve `CONFIRMED` for verified device completion; keep staff kitchen acknowledgment separate.

An authorized reprint creates a new linked job marked **REPRINT**, with copy number, actor, reason, and timestamp. Do not mutate the original job to disguise a repeat. A cancellation competing with dispatch must be serialized where possible; once sending may have begun, create a cancellation notice and require kitchen acknowledgment. Dispatch eligibility is ticket-type-specific: a cancelled order must still permit its authorized cancellation notice. Software cannot retract paper already printed.

Sanitize ticket text and remove control characters that could inject printer commands. Wrap and truncate predictably while preserving quantities, modifiers, and allergy warnings. Test actual output using long orders, accented characters, long modifiers, and representative special instructions.

Initial operating defaults: poll every 2 seconds; heartbeat every 15 seconds; offline after 45 seconds; overdue print alert after 30 seconds; escalation after 120 seconds. Make these configurable. Pause new Checkout when no healthy fulfillment channel exists. A manager may activate an audited, expiring KDS-only fallback. Record staff handling and suppress safe, undispatched original tickets before printer recovery; reconcile UNKNOWN first. Existing paid orders remain visible and recoverable. Database recovery must pause dispatch until provider transactions and bridge journals have been reconciled; never blindly replay restored print work.

## 7. Security, privacy, and financial rules

Enforce roles at API boundaries; hiding a button is not authorization. Use MFA for privileged staff, secure session handling, CSRF protection where applicable, rate limits, input validation, and audit trails. A guest order tracking reference must be unguessable and access-controlled; sequential order numbers are not credentials.

Never store raw card numbers or CVCs. Never commit secrets, credentials, production customer exports, or webhook payloads containing unnecessary personal information. Keep Stripe and bridge credentials environment-specific, scoped, rotatable, and outside the browser bundle. Use synthetic data and Stripe test mode during development. Do not run live charges or refunds merely to make an automated test pass.

Use effective-dated tax configuration and retain order tax snapshots. Do not hard-code 13% across all baskets: the Ontario prepared-food rebate and the treatment of tips, discounts, and mandatory charges require approved rules. Do not assume an external tax service handles every restaurant edge case without verification.

Separate operational customer details from financial retention requirements. Implement approved retention, deletion, access, and redaction policies. Marketing consent must be separate from transactional order communication. Keep delivery addresses absent when fulfillment is pickup. Treat free-text allergy notes as sensitive operational data and expose them only where needed.

## 8. Implementation sequence

Build in vertical slices, with observable success and failure paths:

1. Establish the repository, CI, migrations, configuration validation, domain types, and seed data clearly labeled as fixtures. Begin a physical printer feasibility test at this stage, before committing to the full implementation.
2. Deliver menu selection, validated modifiers, server pricing, availability, and a reserved pickup slot.
3. Add Stripe Checkout, durable webhook ingestion, canonical payment reconciliation, order acceptance, and the outbox.
4. Deliver the staff queue and KDS with authorized transitions and customer tracking.
5. Add a simulated print adapter, stable jobs, leases, journal recovery, and ambiguity handling.
6. Qualify the actual bridge and printer on site; add scheduled release, cancellation notices, and reprints.
7. Complete receipts, notifications, refunds, reporting, retention, monitoring, and incident runbooks.
8. Rehearse failures, restore backups, complete staff training, and validate launch decisions.

A simulator is a development aid. Do not display simulator success as production printer readiness or ship mock payment success behind a production endpoint.

## 9. Verification and completion

Create repository scripts for formatting, linting, type checking, unit tests, integration tests, end-to-end tests, and production builds. Proposed names include `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm build`; these are not runnable until the actual project defines them. Report the commands that really ran and their results.

Required automated coverage includes:

- Price tampering, tax/discount rounding, modifiers, stock limits, reservation expiry, and daylight saving transitions.
- Invalid signatures, duplicate/out-of-order webhook delivery, concurrent Checkout requests, uncertain provider responses, and late or duplicate payments.
- Worker/database/Redis restarts, replayed outbox messages, and reconciliation recovering missing processing.
- Refund limits, concurrent refunds, pending/failed provider refunds, and cancellation versus dispatch races.
- Print lease expiry, bridge reboot, lost acknowledgment, idempotent safe retry, explicit reprint, and cancelled scheduled orders.
- Cross-role access denial, guest tracking isolation, input/print injection, redaction, and accessibility of critical flows.

Hardware acceptance must additionally cover paper out, cover open, power loss during a ticket, network interruption, bridge restart, readable long tickets, and recovery without silent omissions or unattended duplicates. Measure transport and device-confirmed outcomes separately. Run the proposed load profile and restore a backup to demonstrate the stated recovery targets; configuration alone is not evidence.

A change is complete when its SRS requirements are linked to meaningful tests, migrations are reversible or have a documented recovery plan, logs and alerts explain failure, affected documents and runbooks match behavior, and checks pass. Report what changed, what was verified, and unresolved business or hardware dependencies. Never claim live readiness from a successful local demo.

## 10. Reference verification

Before implementing external integrations, consult their current official documentation and record the selected API/protocol versions. The design draws on [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), and [Stripe refunds](https://docs.stripe.com/refunds). Printer capabilities must be verified against the exact selected manufacturer's model, firmware, interface, and SDK documentation.

These instructions define the proposed engineering standard. They do not assert that the restaurant has approved every operating policy, that hardware has been selected, or that implementation and acceptance testing have already occurred.
