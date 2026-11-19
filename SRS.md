# Wok & Chop — Software Requirements Specification

Version: 1.0 draft  
Date: 18 November 2026  
Status: Proposed implementation baseline; business and hardware decisions require owner approval before launch.

## 1. Purpose and document authority

The local delivery extension must validate server-side pricing and Ontario postal eligibility, store each request once, isolate guest tracking and account history, and require manager authorization and a current order version for stage changes. The local mode records unpaid test deliveries. FR-017 continues to govern launch. [Local home delivery](docs/LOCAL-DELIVERY.md)

This specification defines measurable requirements for Wok & Chop's customer ordering website, restaurant administration, kitchen workflow, Stripe payments, and automatic kitchen thermal printing. It is intended for the development team, QA team, restaurant owner, payment administrator, and installer.

The restaurant information supplied by the owner is: **Wok & Chop**, a Halal Hakka Chinese restaurant at **790 Kanata Ave, Unit M2A, Kanata ON**. “Ottawa’s First Authentic Hakka Chinese” and “Fresh • Flavorful • 100% Halal” are owner-supplied brand statements. This document does not independently establish those claims or a halal certification.

Read [PRD.md](PRD.md) for product intent, [ARCHITECTURE.md](ARCHITECTURE.md) for implementation design, [ARCHITECTURE-ESSENTIALS.md](ARCHITECTURE-ESSENTIALS.md) for the short technical summary, and [AGENT.md](AGENT.md) for coding-agent instructions. Requirement IDs in this document are the acceptance references. Architecture changes must preserve these requirements or explicitly revise them with a recorded decision.

“Shall” means a mandatory requirement within the stated release scope. Targets are proposed service objectives to verify during testing, not assertions about a deployed service. Owner approvals in this document are launch prerequisites, not prerequisites for preparing this brief.

## 2. Scope, assumptions, and definitions

### 2.1 Release boundaries

**Phase 1:** one location; CAD payments; guest checkout; responsive menu and cart; ASAP and scheduled pickup; Stripe-hosted Checkout with immediate capture; cards and eligible wallets; customer receipt and tracking; menu administration; staff order dashboard; kitchen display system; automatic kitchen order tickets; refunds; monitoring and recovery.

**Conditional later scope:** delivery, customer accounts, loyalty, promotions beyond explicitly approved pricing rules, native mobile applications, POS integrations, multiple branches, inventory procurement, table ordering, and accounting integrations. Delivery remains disabled until its operational and acceptance requirements are approved. Online cash payment, delayed payment methods, and buy-now-pay-later are outside the Phase 1 baseline.

The proposed technology is a TypeScript monorepo with Next.js, NestJS, PostgreSQL, Redis/BullMQ, a worker, and an always-on Linux print bridge with a SQLite journal. Exact supported versions are pinned during implementation. PostgreSQL is authoritative; Redis is not the sole record of an order or print obligation.

| Term | Meaning |
|---|---|
| KOT | Kitchen order ticket instructing the kitchen what to prepare |
| Customer receipt | Financial order summary issued after confirmed payment |
| KDS | Kitchen display system showing actionable orders and acknowledgments |
| Canonical payment | The single successful payment assigned to fund an order |
| Payment attempt | One controlled checkout/payment lifecycle; distinct from the order |
| Reservation | Temporary stock/capacity allocation held for a checkout attempt |
| Outbox | Durable side-effect instruction saved with its business transaction |
| UNKNOWN print result | Output may have occurred, but its outcome cannot be established |
| Eligible production KOT | Verified canonical capture, valid acceptance, due preparation, no cancellation, and station routing; cancellation notices and receipts have separate eligibility rules |

### 2.2 Configurable baseline

The restaurant's operational timezone is **America/Toronto**, independent of server or customer's device timezone. Store instants in UTC and preserve the requested local time and zone for scheduled orders. Menu, prices, tax profiles, opening hours, order cutoffs, preparation times, capacity, telephone number, cancellation policy, printer model, and public domain are not supplied and shall not be invented.

Proposed defaults are: quote validity 5 minutes; checkout reservation and Stripe session lifetime 30 minutes, aligned after verification against Stripe limits; bridge polling every 2 seconds; heartbeat every 15 seconds; device offline after 45 seconds without heartbeat; overdue print alert at 30 seconds; unresolved escalation at 120 seconds. These defaults require configuration and observable timestamps.

## 3. Actors and authorization

| Actor | Allowed capabilities | Restricted capabilities |
|---|---|---|
| Guest customer | Browse, order, pay, view own receipt/status using a secure link | Other customers' orders; internal notes; administrative actions |
| Kitchen staff | Read relevant food tickets, acknowledge, start preparation, mark ready | Refunds, tax changes, payment secrets, unnecessary customer details |
| Front-of-house staff | Search operational orders, hand over orders, assist customers, request authorized reprints | Owner settings and financial actions unless separately granted |
| Manager | Pause ordering, manage availability/capacity, resolve exceptions, cancel, refund, approve fallback | Raw card data; bypass of audit records |
| Owner/administrator | Staff roles, business configuration, reports, integration settings | Access to card credentials, which the application never receives |
| Print bridge | Claim assigned printer jobs, report status, heartbeat | Menu edits, refunds, other locations or devices |
| Background worker | Execute scoped reconciliation, dispatch, and notification work | Unrestricted human administrative sessions |

Permissions shall be enforced by the API, not merely by hidden interface buttons. Each privileged action records the authenticated actor and reason when required.

## 4. Functional requirements

### 4.1 Brand, menu, and cart

| ID | Requirement |
|---|---|
| FR-001 | The website shall show owner-approved restaurant name, address, branding, hours, ordering availability, and contact information. Unapproved placeholder contacts and invented certification badges shall not appear in production. |
| FR-002 | The menu shall support ordered categories; item name, description, image, base price, availability, applicable tax category, and kitchen display name. Items shall have stable identifiers independent of editable names. |
| FR-003 | Items shall support variants and modifier groups with minimum/maximum selections, required selections, permitted quantities, price adjustments, and sold-out choices. The server shall reject invalid combinations. |
| FR-004 | The customer shall see each quantity, selected modifier, item subtotal, and order total before payment. Changing quantities or modifiers shall trigger server revalidation. |
| FR-005 | The system shall support bounded item notes and order notes. It shall remove unsafe HTML and printer control sequences while preserving readable text. Limits and validation errors shall be visible to the customer. |
| FR-006 | Approved dietary and allergen information shall be displayed without inferring that halal means allergen-free. An allergy note shall be conspicuous to staff; the interface shall direct customers with allergy questions to the restaurant and shall not guarantee an allergen-free meal. |
| FR-007 | The cart shall persist across a normal page refresh on the same browser. Restoration shall revalidate current item availability, prices, and fulfillment options, explaining changes before charging. |
| FR-008 | Managers shall publish or disable menu items and modifiers and set temporary sold-out status. Historical orders shall retain their purchased names, quantities, modifiers, prices, and tax snapshots when the menu later changes. |

### 4.2 Service availability, capacity, and scheduling

| ID | Requirement |
|---|---|
| FR-009 | The server shall apply regular hours, date-specific closures, order cutoffs, preparation lead time, and manager pauses to determine available ordering options. The customer shall receive an explicit closed, paused, or sold-out explanation. |
| FR-010 | ASAP pickup shall display an estimated ready time based on approved preparation and capacity settings, measured from payment acceptance and confirmed at that time. A change before payment shall be disclosed; a material change after payment shall create an operational update and customer notification. |
| FR-011 | Scheduled pickup shall offer only approved future slots within the configured booking horizon, leaving the full 30-minute checkout window before the preparation cutoff. The customer shall explicitly review the restaurant-local date and time. Nonexistent daylight-saving times shall be rejected; ambiguous local times shall be resolved explicitly before reservation. |
| FR-012 | A checkout shall atomically reserve configured item quantities and slot capacity. Concurrent requests shall not oversell the last available unit or slot. The system shall support a capacity model approved by the restaurant, such as preparation units per slot. |
| FR-013 | Reservations shall persist with expiry and payment-attempt linkage. Expiry processing shall establish provider expiry or another definitively unpaid terminal state before releasing the reservation; races with confirmed payment shall be serialized. If Stripe is unreachable or the outcome is uncertain, retain the hold and alert. A failed card attempt inside an open Checkout session shall not release its reservation or permit a second session. |
| FR-014 | A paid scheduled order shall appear immediately on the scheduled dashboard. Its production KOT shall become eligible at the persisted preparation-release time, derived from pickup time and preparation lead time. Scheduler restart shall recover overdue releases. |
| FR-015 | If an informational scheduled-order ticket is enabled, it shall clearly say HOLD and show its due time. It shall use a separate ticket type and shall not count as the production KOT or instruct immediate cooking. |
| FR-016 | A manager pause, closing cutoff, or emergency closure shall block new checkout creation. An already-open session shall be expired where safely possible and reconciled. If payment nevertheless succeeds without valid fulfillment conditions, the order shall enter exception handling instead of disappearing or cooking unattended. |
| FR-017 | Delivery shall be disabled at launch unless separately approved. Enabling it shall require tested address validation, service-area eligibility, fees/taxes, delivery capacity and promises, contact handling, dispatch ownership, cancellation rules, and proof of operational readiness. |

### 4.3 Checkout, pricing, and tax

| ID | Requirement |
|---|---|
| FR-018 | Guest checkout shall collect the minimum approved pickup contact details, selected fulfillment time, and explicit acknowledgment of applicable terms. Creating an account shall not be required. Marketing permission shall be separate and unchecked by default. |
| FR-019 | The server shall calculate all money in integer CAD cents from trusted menu/configuration data. Client-submitted prices, totals, discounts, tax amounts, and delivery fees shall never be authoritative. |
| FR-020 | A quote shall return its ID, expiry, item and modifier breakdown, discounts if enabled, taxable basis, tax components, approved fees, optional gratuity, total, currency, and configuration version. An expired or changed quote shall require customer review before a new payment attempt. Quote expiry applies before session creation; the frozen order snapshot remains valid throughout its active payment attempt. |
| FR-021 | The tax engine shall use effective-dated, accountant-approved tax categories and rules. It shall support the applicable Ontario prepared-food rebate conditions rather than applying a blanket 13% to every transaction. Discount allocation, gratuities versus mandatory charges, rounding, and refunds shall have approved fixtures. |
| FR-022 | The checkout total sent to Stripe shall equal the immutable order snapshot total. The application shall verify currency, amount, order association, and payment environment when accepting a successful payment. A mismatch shall be quarantined for investigation, with no production KOT. |
| FR-023 | Checkout creation shall require an application idempotency key and request fingerprint. Repeating the same request shall return the same logical result; reuse of that key with different input shall return a conflict. |
| FR-024 | At most one active payment attempt shall exist per order. Before replacing an attempt, the application shall expire or establish the terminal state of its existing Stripe session and reconcile any success. An uncertain session-creation response shall retain the CREATING attempt and recover the same request with the same provider idempotency key, not start a fresh attempt. Attempt creation state is distinct from the order's aggregate payment state. |

### 4.4 Stripe payment processing

| ID | Requirement |
|---|---|
| FR-025 | Phase 1 shall use Stripe-hosted Checkout with immediate capture for cards and eligible wallets. Payment-method enablement shall be explicitly configured so delayed methods and pay-later products are not accidentally introduced. |
| FR-026 | The application shall use a verified Stripe webhook and reconciliation process to establish payment success. The browser success page, URL parameters, screenshots, and client claims shall never mark an order paid or directly trigger printing. |
| FR-027 | The webhook endpoint shall verify the signature using the original raw body and correct environment secret. Invalid signatures shall be rejected. Valid relevant events shall be durably persisted before returning success; database persistence failure shall return an error for provider retry. |
| FR-028 | The webhook inbox shall deduplicate provider event IDs. Business processing shall also deduplicate semantic outcomes across different event types concerning the same payment. Duplicate and out-of-order delivery shall not create a second accepted order or original KOT. |
| FR-029 | A worker shall verify the authoritative Checkout/payment state and execute one database transaction that assigns the canonical payment, updates payment and fulfillment state, consumes a valid reservation, and writes required outbox records. No payment-state commit shall depend on the printer being online. |
| FR-030 | A checkout completion event with unpaid status shall not authorize fulfillment. Unexpected asynchronous payment events shall be recorded and reconciled safely even though delayed methods are disabled. A failed attempt shall not overwrite an already successful order payment. |
| FR-031 | A verified successful payment received after cancellation, expiry, loss of capacity, or an invalid reservation shall create an EXCEPTION requiring manager resolution. Customers shall see a truthful payment-received/review status; no automatic cooking shall occur until valid acceptance is established. |
| FR-032 | A second successful payment for the same order shall create a duplicate-payment exception associated with that payment. It shall not create another production ticket or roll back an order already being prepared or completed. A manager shall resolve the excess charge through a traceable refund workflow. |
| FR-033 | Payment reconciliation shall run at least every minute for eligible unresolved attempts and stored unprocessed events. A separate durable sweep shall detect paid, accepted, due orders without a required print obligation, also at least every minute. |

### 4.5 Customer confirmation and restaurant operations

| ID | Requirement |
|---|---|
| FR-034 | Confirmed payment shall create a customer receipt independent of kitchen print success. It shall include order reference, restaurant identity, purchased items/modifiers, amounts, applicable taxes, paid total, fulfillment type/time, and approved support contact. Payment credentials shall never appear. |
| FR-035 | A guest shall view order status through a high-entropy, scoped, expiring access mechanism. Sequential public order numbers shall not authorize access. The customer view shall hide kitchen notes, other customer data, and internal payment identifiers not required for support. |
| FR-036 | The restaurant dashboard shall show new, scheduled, in-preparation, ready, completed, cancelled, and exception orders, with independent payment and printing indicators. New and unresolved orders shall have visible alerts that do not depend solely on sound or colour. |
| FR-037 | Authorized staff shall acknowledge an order, start preparation, mark ready, and mark collected/completed using validated transitions. Staff acknowledgment shall be recorded separately from device print acknowledgment. |
| FR-038 | The KDS shall present quantities, modifiers, allergy flags, notes, promised time, elapsed time, station, and preparation state in a kitchen-readable layout. It shall display only necessary customer details and clearly identify scheduled HOLD items. |
| FR-039 | Transactional receipt and ready notifications shall use persisted jobs with bounded retries and delivery status. Notification failure shall create a visible support issue but shall not erase an order, repeat a charge, or reprint a KOT. The tracking page remains usable when email delivery fails. |
| FR-040 | Staff search and reports shall use server-authorized filters for date, reference, state, and permitted contact data. Daily reconciliation shall show gross sales, approved discounts, tax components, gratuities, successful and pending refunds, and payment exceptions in restaurant-local business-day boundaries. |

### 4.6 Automatic kitchen printing

| ID | Requirement |
|---|---|
| FR-041 | An eligible paid ASAP order shall automatically create and dispatch a production KOT without a browser print dialog or a customer device remaining online. A scheduled order shall do so only at its preparation-release time. |
| FR-042 | Phase 1 shall qualify an actual 80 mm wired Ethernet thermal printer, its firmware, and its ESC/POS or vendor SDK driver. Qualification shall cover text width, cutting, encoding, status capability, faults, and restart behaviour. Compatibility shall not be inferred from the word “thermal.” |
| FR-043 | The bridge shall run as an auto-starting service on an always-on Linux device. It shall communicate outbound over authenticated HTTPS, poll every 2 seconds when healthy, send a heartbeat every 15 seconds, and expose no unauthenticated public printer port. |
| FR-044 | Every print job shall have a stable ID, immutable payload hash, order revision, station, type, timestamps, and attempt history. A database uniqueness rule shall prevent more than one original production KOT for the same order, revision, station, and type. |
| FR-045 | Job claiming shall use authenticated leases and fencing tokens, with one active bridge/sender per assigned printer. The bridge shall durably journal and fsync a job and its sending intent before a possible physical side effect, and obtain the server's dispatch authorization. A stale lease holder shall not dispatch without a current authorization check. |
| FR-046 | Retry shall be automatic only when evidence establishes that no output could have occurred. Lease expiry alone is not that evidence; a LEASED job may be reassigned only after no-send evidence. The same logical job ID shall be reused for safe retries, with bounded exponential backoff. A SENDING job with lost outcome, or other possible output followed by timeout, crash, or lost acknowledgment, shall become UNKNOWN and shall not be blindly resent. |
| FR-047 | The system shall distinguish DELIVERED transport evidence from CONFIRMED device-completion evidence. Socket success or operating-system acceptance alone shall not be labelled physical print success. Staff verification shall be a separate resolution record and shall not fabricate device evidence. |
| FR-048 | An authorized reprint shall require a reason and actor, create a new linked job, and visibly print REPRINT with the original order reference and copy count. Repeating the same reprint request shall not create additional copies. |
| FR-049 | The KOT shall show restaurant identity, large order reference, order type, paid marker, local order/due time, station, item quantities/names, indented modifiers, notes/allergy flags, and ticket kind/copy marker. Customer receipt amounts shall not be required on the kitchen copy. No full payment data shall print. |
| FR-050 | A missing heartbeat for 45 seconds shall mark the bridge offline. A due job unresolved after 30 seconds shall alert staff; after 120 seconds it shall escalate. Queue age, device connectivity, paper/cover status where supported, and UNKNOWN jobs shall be visible. |
| FR-051 | New checkout shall pause when no healthy fulfillment channel exists. A manager may activate an audited, time-limited KDS-only fallback after acknowledging manual handling. Existing paid obligations shall remain durable; expiry of the fallback shall reevaluate ordering readiness. Staff acknowledgment of a manually handled order shall suppress its queued, unsent original production jobs with an audit record. UNKNOWN jobs must be resolved first; printer recovery shall not issue a second cooking instruction for an order already handled through KDS. |
| FR-052 | Restoring connectivity or power shall recover the journal and reconcile it with server jobs before dispatch. Jobs known to have been sent shall not be duplicated simply because a server acknowledgment was lost. UNKNOWN cases shall remain held for staff resolution. |
| FR-053 | Cancelling a queued, unsent ticket shall atomically prevent its release. If dispatch may already have begun, the system shall show a kitchen cancellation alert and, when possible, issue a clearly labelled cancellation notice; kitchen acknowledgment shall be required. A refund alone shall not silently cancel cooking. |

### 4.7 Cancellations, refunds, and administration

| ID | Requirement |
|---|---|
| FR-054 | The customer shall see the approved cancellation policy before payment. Staff shall apply that policy with role checks, reasons, and an audit trail. Phase 1 shall not silently edit a paid order's items or total; a changed purchase requires an explicit cancellation/refund and new-order flow as appropriate. |
| FR-055 | Managers shall request full or partial refunds against the original successful payment. Under a lock, enforce successful refunds + existing pending refund reservations + the requested refund amount ≤ the original captured amount, including concurrent requests. Each request shall have a stable idempotency key. |
| FR-056 | Refund requests shall track PENDING, SUCCEEDED, or FAILED independently of fulfillment. The customer shall not be told a refund succeeded merely because the request was created. Webhooks and reconciliation shall update the authoritative outcome and any failed-refund exception. |
| FR-057 | Refund amounts shall preserve original tax/discount allocation, support explicit tip/fee treatment, and record item-level or amount-level reasons. Orders shall retain their original financial snapshot and an additive adjustment ledger. |
| FR-058 | Authorized administrators shall manage staff access, business hours, capacity, tax profiles, integration credentials through protected mechanisms, printer mappings, fallback settings, and notification templates. Changes shall be versioned or auditable and shall not rewrite historical orders. |
| FR-059 | The application shall provide audited data export, correction, and retention/deletion workflows consistent with the approved privacy and financial retention policy. Operational contact data and retained financial records shall be separable; failed deletion jobs shall be observable. |

## 5. State and data integrity

### 5.1 Independent state axes

| Axis | Allowed states | Guard rules |
|---|---|---|
| Order payment | UNPAID, PROCESSING, PAID, PARTIALLY_REFUNDED, REFUNDED, FAILED | Payment attempts remain separate; an attempt failure cannot reverse PAID. Refund aggregate reflects succeeded refunds, not merely requests. |
| Fulfillment | AWAITING_PAYMENT, ACCEPTED, SCHEDULED, IN_PREPARATION, READY, COMPLETED, CANCELLED, EXCEPTION | Payment success alone does not guarantee valid fulfillment. Scheduled release requires due time; staff transitions require authorization. |
| Print | QUEUED, LEASED, SENDING, DELIVERED, CONFIRMED, RETRY_WAIT, UNKNOWN, FAILED, CANCELLED | CONFIRMED requires device evidence; UNKNOWN prohibits automatic resend; cancellation cannot erase a possible physical side effect. |
| Refund | PENDING, SUCCEEDED, FAILED | Provider state is reconciled; fulfillment is not implicitly modified. |

Normal ASAP flow is AWAITING_PAYMENT → ACCEPTED → IN_PREPARATION → READY → COMPLETED. Normal scheduled flow is AWAITING_PAYMENT → SCHEDULED → ACCEPTED at release time, followed by preparation. CANCELLED and EXCEPTION transitions require a recorded cause. Resolving an exception must explicitly choose acceptance with valid capacity, cancellation/refund, or another approved action. A duplicate-payment exception is an associated operational case when fulfillment has already progressed; it must not rewind that work.

Receipt issuance, ticket delivery, kitchen acknowledgment, preparation, and collection are different events. None shall be used as an undocumented substitute for another.

### 5.2 Required stored records

At minimum persist locations and configurations; menu items/variants/modifiers; availability and capacity slots; quotes; orders and immutable order-line snapshots; reservations; payment attempts and provider IDs; webhook inbox; transactional outbox; refunds and financial adjustments; print jobs/attempts/device registrations; scheduled release timestamps; notification jobs; staff identities/permissions; and append-only audit events.

All records shall carry stable internal IDs and applicable creation/update timestamps. Enforce uniqueness for provider event IDs, provider payment IDs, active order attempts, original KOT identities, and operation idempotency keys. Use optimistic versions or row locks for competing state changes. Store money as integer cents and distinguish requested, authorized, captured, and refunded values where relevant. Never store card numbers, CVCs, or magnetic-stripe data.

The authoritative payment acceptance and outbox write shall be atomic. Workers shall be restartable and idempotent. Loss of Redis shall not lose paid orders, pending refunds, or required prints. Printer receipts and kitchen payloads shall be generated from order snapshots, not live menu data.

## 6. External interfaces

| Interface | Required behaviour |
|---|---|
| Customer website → API | Versioned HTTPS JSON contracts; validation; quote/checkout idempotency; secure guest access; useful availability and conflict errors |
| Stripe → webhook | Public HTTPS endpoint, raw-body signature verification, durable inbox, bounded response time, asynchronous business processing |
| API/worker → Stripe | Server-only secret, pinned API version, stable idempotency keys, timeout recovery and environment validation |
| Staff/KDS → API | Authenticated role-scoped commands; live updates with reconnection and snapshot recovery; polling fallback |
| Bridge → API | Per-device credentials, scoped claims, leases/fencing, payload hash checks, authenticated acknowledgments, heartbeat |
| Bridge → printer | Qualified adapter and encoding; known command set; bounded timeouts; honest transport/device status reporting |
| Notifications | Approved provider; idempotent templates; minimal personal data; delivery/error status and retry policy |

API contract tests shall validate request/response schemas, authorization, idempotency conflicts, rate-limit errors, and provider timeout behaviour. Exact endpoints and payloads are defined in the architecture document.

## 7. Nonfunctional requirements

| ID | Requirement and verification |
|---|---|
| NFR-001 | Ordering API availability target: 99.9% per calendar month. Measure synthetic browsing, quote, and checkout initiation separately from provider availability and payment completion; publish excluded maintenance/dependency categories rather than hiding them. |
| NFR-002 | Under the proposed test load of 100 concurrent browsing sessions and 20 checkout starts/minute, quote response p95 shall be below 500 ms and webhook durable acceptance p95 below 2 seconds, excluding network transit. |
| NFR-003 | For eligible healthy ASAP jobs, at least 95% shall reach the adapter's documented delivery/device-acknowledgment level within 10 seconds of verified payment. Report acknowledgment level; do not claim paper completion for transport-only hardware. |
| NFR-004 | Capacity testing shall use a provisional 300 paid orders/day and a peak of 30 orders/15 minutes, plus burst and retry tests. Actual restaurant demand shall replace these sizing assumptions before final infrastructure commitment. |
| NFR-005 | Recovery targets are RPO ≤5 minutes and RTO ≤60 minutes using managed backups/PITR and a tested restore runbook. Quarterly restore drills shall record achieved values. A restore shall pause print dispatch while Stripe payments, cloud jobs, and bridge journals are reconciled; only then may dispatch resume. |
| NFR-006 | All public traffic shall use HTTPS; secrets shall remain server-side in protected configuration. Staff privileged accounts shall require MFA. Sessions shall use appropriate secure cookies, expiry, CSRF protection where applicable, and revocation. |
| NFR-007 | Authorization, input validation, rate limiting, dependency scanning, and security tests shall cover checkout abuse, cross-order access, role escalation, injection, forged webhooks, print-control injection, and leaked guest links. |
| NFR-008 | Logs and analytics shall redact payment secrets, guest tokens, and unnecessary personal data. Receipt/checkout pages shall avoid third-party scripts that unnecessarily expose order details. Audit records shall be access-controlled and tamper-resistant. |
| NFR-009 | The owner shall approve retention periods, purposes, processor arrangements, privacy notices, and rights-handling procedures before launch. Marketing consent shall be separate from transactional ordering; applicable Canadian privacy, marketing, and accessibility obligations require explicit review. |
| NFR-010 | Customer and staff web flows shall target WCAG 2.2 AA, including keyboard operation, focus visibility, labels, contrast, error association, screen-reader status updates, and non-colour-only alerts. Verify manually as well as with automated checks. |
| NFR-011 | Customer flows shall work on current supported mobile and desktop browser versions established in the test matrix. KDS shall remain usable on the selected restaurant tablet/display. Offline browser mode shall not create or charge orders. |
| NFR-012 | Every payment, print, refund, notification, and scheduling obligation shall expose correlation IDs, status, attempts, and age. Alerts shall identify an actionable owner and escalation path; startup checks shall detect missing production configuration. |
| NFR-013 | Deployments shall use migrations, rollback-compatible changes, environment isolation, and verified backups. Production data and credentials shall not be copied into developer fixtures. Workers and bridge updates shall preserve pending jobs and journals. |
| NFR-014 | Automated unit/integration/contract tests shall cover financial rules and concurrent state changes; real hardware tests shall cover physical printing. A passing simulated printer test alone shall not approve launch. |

## 8. Acceptance and traceability matrix

Each scenario shall retain evidence: test inputs, expected and actual state, relevant IDs, timestamps, and screenshots or physical tickets where appropriate. Synthetic data shall be used except for an owner-approved live payment smoke test.

| Test | Requirements | Acceptance scenario |
|---|---|---|
| AT-01 Menu and customization | FR-001–008 | Publish an item with required modifiers; reject invalid selections and disabled choices; refresh a saved cart after a price change; preserve an older purchased snapshot. Verify allergy and unsafe-note handling. |
| AT-02 Hours and capacity | FR-009–013 | Test closure, cutoff, pause, and the last available capacity unit with concurrent checkouts. Only one reservation succeeds; abandoned holds release safely after payment reconciliation. |
| AT-03 Scheduled pickup | FR-010–011, 014–015 | Pay for a later slot, restart the scheduler, and verify one production KOT at release time. HOLD copy, if enabled, is distinct. Test both DST transition types, infeasible slots within the checkout window, and ASAP ETA measured from payment acceptance. |
| AT-04 Checkout arithmetic | FR-018–024 | Tamper with client totals; test required fields, expired quotes, concurrent submit, repeated idempotency key, changed request fingerprint, and external timeout. Preserve the frozen total through the active session, retain CREATING after an uncertain creation response, and retain reservation after a failed card within an open session. |
| AT-05 Approved tax fixtures | FR-019–022, 057 | Accountant-approved fixtures cover standard taxable meals, qualifying/nonqualifying small prepared-food purchases, modifiers, discounts, fees, tips, rounding, and partial refunds. Totals and stored components match expected cents. |
| AT-06 Successful payment | FR-025–030, 034 | Complete Stripe test payment; close the browser before redirect. One order becomes paid/accepted, one receipt job and one original KOT obligation exist. Repeat webhook events and vary their order without duplicates. |
| AT-07 Invalid/uncertain payment | FR-022, 026–030 | Forge a webhook, change amount/currency association, send unpaid completion, fail an attempt, and interrupt inbox persistence. No unauthorized KOT is released; durable events recover after restart. |
| AT-08 Late/duplicate payment | FR-013, 016, 024, 031–033 | Race expiry/cancellation with success and inject a second successful payment. No capacity oversell or extra original KOT; manager sees an actionable exception and truthful customer status. |
| AT-09 Customer/staff visibility | FR-034–040 | Verify receipt breakdown, secure tracking, live/reconnected KDS, role restrictions, ready/collection transitions, and notification failure recovery. Another customer's reference grants no access. |
| AT-10 Healthy physical printer | FR-041–045, 049; NFR-003, 014 | Complete payment with customer browser closed. Verify readable 80 mm ticket, modifiers, due time, cut, station, no payment secrets, stable job ID, and measured acknowledgment latency on actual hardware. |
| AT-11 Printer faults | FR-046–052 | Test paper-out, cover-open where detectable, unplugged network, bridge power loss, and a crash after bytes may have been sent. Safe failures retry; ambiguous output becomes UNKNOWN with no unattended duplicate. |
| AT-12 Reprint and cancellation | FR-048, 053–054 | Repeat one reprint request and verify one marked copy. Race cancellation with dispatch; unsent work is suppressed or a cancellation alert/notice requires kitchen acknowledgment. |
| AT-13 Service fallback | FR-050–052 | Stop heartbeat and wait for offline/overdue/escalation thresholds. New checkout pauses without a healthy channel. Manager enables expiring KDS-only fallback; actions are audited and expiry reevaluates readiness. Acknowledge an order in fallback, restore the printer, and verify no duplicate production instruction; resolve UNKNOWN separately. |
| AT-14 Refunds | FR-055–057 | Race two partial refunds, retry after timeout, and deliver pending/success/failure events out of order. Refunds never exceed the available balance; cooking state does not silently change. |
| AT-15 Admin and privacy | FR-058–059; NFR-006–009 | Exercise role boundaries, MFA, audited setting changes, retention jobs, guest-token expiry, export/correction permissions, and production log redaction. |
| AT-16 Recovery and load | FR-033, 044–047, 052; NFR-001–005, 012–014 | Restart API/workers, lose Redis, replay outbox, restore PostgreSQL, and recover bridge journal. Reconcile external payments and possible prints before replay. Meet approved load and recovery targets without losing obligations. |
| AT-17 Accessibility/devices | NFR-010–011 | Complete menu, modifiers, checkout handoff, tracking, and staff workflow with keyboard/screen reader and selected mobile devices; verify errors, zoom, and status announcements. |
| AT-18 Delivery gate | FR-017 | Production shows pickup only while delivery is disabled. Any enablement requires its separately approved acceptance suite and operational sign-off. |

## 9. Launch acceptance gates

Launch requires no unresolved critical payment, order-loss, privacy, authorization, or print-duplication defect. The owner shall approve menu/content, prices, hours, capacity, policies, contact details, and brand claims. The accountant shall approve tax and refund fixtures. The technical lead shall approve deployment, monitoring, recovery, access controls, Stripe configuration, and actual printer qualification.

Restaurant staff shall demonstrate payment-to-KOT operation, scheduled release, manual acknowledgment, cancellation after printing, UNKNOWN resolution, marked reprints, paper replacement, offline fallback, and closing/opening checks. A live payment/refund smoke test shall use explicit owner authorization and record its outcome without exposing card data. Production monitoring must have named responders before accepting customer money.

Open decisions include the physical printer model/firmware, bridge hardware, internet backup, public domain, production payment account, email/SMS channels, exact operating hours and capacity, tax profile, retention policy, refund policy, and delivery scope. None may be silently filled with invented business facts.

## 10. Source references

Official references consulted for this specification family on 18 November 2026. Provider behaviour must be rechecked when implementing the pinned API/SDK versions. Product defaults, timing thresholds, workflows, and service targets above are proposed design decisions.

- [Stripe: fulfill Checkout orders](https://docs.stripe.com/checkout/fulfillment) — server-side fulfillment and payment-state checks.
- [Stripe: webhook endpoints](https://docs.stripe.com/webhooks) — signature verification, raw request body, asynchronous event handling, and retries.
- [Stripe: idempotent requests](https://docs.stripe.com/api/idempotent_requests) — safe provider request retries; application business deduplication remains necessary.
- [Stripe: refunds](https://docs.stripe.com/refunds) — partial refunds and pending/failed refund outcomes.
- [CRA: GST/HST rates](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html) — Ontario's standard 13% HST rate; tax treatment depends on the supply.
- [CRA: Ontario prepared-food point-of-sale rebate](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/gi-064/harmonized-sales-tax-ontario-point-sale-rebate-on-prepared-food-beverages.html) — qualifying prepared food/beverage transactions require specific rebate rules.
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/) — proposed accessibility standard; not a claim that this particular business is subject to every legal accessibility provision.
