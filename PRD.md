# Wok & Chop — Product Requirements Document

**Version:** 1.0 draft for implementation planning  
**Date:** 18 November 2026  
**Product:** Direct online ordering, Stripe payments, restaurant operations, and automatic kitchen ticket printing  
**Business:** Wok & Chop, 790 Kanata Ave, Unit M2A, Kanata ON  
**Currency / restaurant time:** CAD / `America/Toronto`

The owner additionally requested a local, unpaid home-delivery workflow. Guests can review a food quote and track a delivery. Authorized managers handle its fulfilment. Live delivery remains subject to the launch decisions below. [Local home delivery](docs/LOCAL-DELIVERY.md)

## 1. Purpose and document status

Build a dependable ordering system through which customers can choose dishes, customize their meals, pay online, and receive a clear pickup commitment. A successfully paid, eligible order must reach the kitchen automatically as a kitchen order ticket (KOT), without requiring a staff member to copy an order or open a browser print dialog.

This document defines the intended product. [SRS.md](SRS.md) contains testable requirements; [ARCHITECTURE.md](ARCHITECTURE.md) defines the implementation; [ARCHITECTURE-ESSENTIALS.md](ARCHITECTURE-ESSENTIALS.md) provides its short reference; [AGENT.md](AGENT.md) gives future development-agent instructions. This is a specification package, not an implemented or production-certified system.

The restaurant description, address, and the phrases “Ottawa’s First Authentic Hakka Chinese” and “Fresh • Flavorful • 100% Halal” were supplied by the owner. The system may use owner-approved wording, but this brief does not independently verify historical priority or halal certification. It must not invent a certification logo, menu, price, opening hour, telephone number, or allergy guarantee.

## 2. Business outcomes and product principles

| Outcome | Required product behavior | Proposed measurement |
| --- | --- | --- |
| Customers order directly with confidence | Fast mobile menu, clear choices, transparent total, guest checkout | Establish conversion and abandonment baselines during the first four weeks; agree improvement targets afterward |
| Every paid order is accounted for | Payment verification, staff order board, reconciliation, exceptions queue | No unexplained paid order missing from the restaurant ledger in acceptance testing; investigate every production mismatch |
| Kitchen receives legible instructions promptly | Automatic KOT, prominent quantities/modifiers, printing alerts | At least 95% of eligible ASAP tickets acknowledged by the healthy print path within 10 seconds of payment verification |
| Avoid duplicate cooking and charges | Repeated clicks return the same attempt; duplicate events do not create another original KOT | Zero extra original KOTs or application-created duplicate successful charges in defined duplicate/retry tests |
| Staff can recover without developer intervention | Pause ordering, safe reprint, cancellation, refund, printer status, exception resolution | Staff complete outage and refund drills before launch |
| Preserve restaurant trust | Approved halal wording, clear policies, careful allergy communication | Owner content signoff and checkout policy review before launch |

The 10-second target measures system processing after payment verification, excludes scheduled jobs before their release time, and is conditioned on a healthy device/network. It is not a promise that every payment produces paper in ten seconds. Customer payment latency and physical printing uncertainty must be measured separately.

## 3. Proposed launch baseline

These are planning decisions, not confirmed current restaurant practices:

- One restaurant location, one kitchen production station, one primary printer.
- Guest-first ordering; an account is not required to buy.
- ASAP pickup and scheduled pickup in Phase 1.
- Online payment through Stripe-hosted Checkout, using cards and supported eligible wallets. Capture happens during checkout.
- Automatic acceptance after verified payment when the order has a valid reservation and remains eligible for fulfillment.
- An always-on local print bridge connected to a qualified wired 80 mm thermal printer. A staff order screen acts as the operational view and controlled fallback.
- Customer email receipt at payment; kitchen production ticket when cooking should begin.
- English initial interface with translation-ready content. Additional languages require approved translations.
- Delivery remains disabled until its area, charges, logistics, staffing, and customer promises are approved.

The owner can change these decisions before implementation. A change to payment capture, acceptance, delivery, or printing must update all affected documents and tests.

## 4. Scope and release priorities

| Priority / release | Included |
| --- | --- |
| P0 — launch essential | Responsive menu and cart; modifiers; availability; guest checkout; server-calculated totals; capacity reservation; Stripe payments; verified order acceptance; automatic original KOT; staff order board; printer health and recovery; cancellations; full/partial refunds; audit records; privacy and payment security; backup and restore |
| P1 — launch complete | Scheduled pickup; ready notifications by email; order tracking; sales and refund reports; holiday hours; configurable preparation estimates; menu-image management; accessible content; operational alerts |
| Phase 2 — separate approval | Restaurant-operated delivery or delivery-provider integration; customer accounts; saved favorites; loyalty; promotions; SMS notifications; customer reviews; multi-station routing; kitchen displays optimized for additional stations |
| Outside this brief’s launch scope | Marketplace aggregation, full accounting package, ingredient procurement, payroll, reservations/table management, dine-in QR ordering, counter cash/POS terminal transactions, split bills, gift cards, subscriptions, native mobile apps, multiple restaurant branches |

Online orders may be managed by staff, but a complete staff-entered counter-order/POS module is not assumed. If required at launch, payment methods, cash handling, and printing rules need a separately approved extension. Receipt viewing or manual browser printing does not satisfy the automatic kitchen-printing requirement.

The owner approved an email offers feature. Visitors can subscribe without a customer account and confirm by email. Managers can preview and send offers to confirmed subscribers. Guests can unsubscribe from any offer. The same Hostinger mailbox handles operational and marketing email, with separate consent and a marketing send allowance.

## 5. Users and access

| Role | Main capabilities | Restrictions |
| --- | --- | --- |
| Guest customer | Browse, customize, pay, view their secure order link, request help | Cannot inspect other orders or mark payment/fulfillment statuses |
| Kitchen staff | View preparation queue, acknowledge tickets, mark preparation/ready, report issues | No refunds, tax changes, staff management, or unnecessary customer financial data |
| Front-of-house staff | View active pickups, contact customer, complete handoff, initiate help requests | Refund and system-setting permissions require explicit assignment |
| Manager | Pause ordering, adjust capacity, resolve exceptions, cancel orders, authorize reprints and refunds, activate temporary fallback | All sensitive actions attributed to an individual account and reason |
| Owner / administrator | Menu, pricing, hours, policies, staff access, integrations, reports | Multifactor authentication; secrets are not displayed as ordinary editable content |
| Service identities | Payment processing, job execution, local printer communication | Narrow machine permissions; no shared human administrator login |

Kitchen visibility should prioritize order number, promised time, item quantities, modifiers, and preparation notes. Customer contact information is available only where operationally necessary. Customer receipt and kitchen ticket are separate views of the same order.

## 6. Customer experience

### 6.1 Discover and browse

The home page presents the approved restaurant brand, food photography, address, ordering status, and a prominent “Order online” action. The menu remains browsable while ordering is closed, with the next available service clearly shown. Search, categories, and item availability must work on mobile without losing the cart.

Actual categories, dish names, descriptions, images, portion options, prices, and preparation information are content inputs from the restaurant. Placeholder dishes must never reach production. Halal messaging must be consistent across landing pages, menu, and checkout.

### 6.2 Customize and build a cart

Each item shows its base price and required selections before it can be added. Modifier groups support minimum/maximum selections, included choices, paid additions, and unavailable options. Potential examples such as spice level or protein are configuration patterns, not claims about the current menu.

The cart shows quantities, modifier prices, per-line totals, fulfillment choice, and a running total. Customers can edit or remove unpaid items. Notes have a defined length limit and clear purpose. Allergy-related notes are prominently flagged to staff and accompanied by guidance to contact the restaurant; the website must not imply that a free-text note guarantees an allergen-free meal.

### 6.3 Select pickup and review the total

Customers choose ASAP or an available scheduled slot. “ASAP” displays an estimate based on current preparation time and kitchen load; its preparation estimate starts from successful payment acceptance, and the confirmed pickup time is shown afterward. Scheduled choices respect business hours, holidays, preparation lead time, slot capacity, and booking horizon. Only offer scheduled choices that preserve the full thirty-minute checkout payment window before the preparation cutoff. Times are always presented in the restaurant’s Toronto timezone, including daylight-saving changes.

The review page shows food subtotal, discounts if later enabled, taxes, any approved charges, optional gratuity if enabled, and the final CAD total before payment. No mandatory charge may appear only after payment. Tax handling uses an accountant-approved, effective-dated profile, including relevant Ontario prepared-food rules and treatment of gratuities/mandatory charges. Do not assume one rate applies to every possible transaction.

### 6.4 Pay and receive confirmation

Collect the minimum necessary name, email, and telephone details. Address is not required for pickup. Marketing consent, if introduced, is separate and optional; purchasing must not require marketing enrollment.

Before creating checkout, the server rechecks the cart, prices, availability, selected slot, and fulfillment-channel health. A quote lasts five minutes. A valid checkout creates a thirty-minute capacity reservation aligned with the payment-session expiry. The paid amount is frozen for that attempt. If the quote expires before checkout begins, present the recalculated total for review rather than silently charging a different amount.

Repeated clicks and connection retries reuse the same active payment attempt. A replacement attempt is created only after the earlier attempt is expired or otherwise resolved. If checkout creation times out, retry the existing attempt with its original idempotency key rather than creating a second session. A customer returning from Stripe sees “Confirming your payment” until the server has authoritative payment evidence. The browser return URL does not make an order paid.

On verified successful payment, show the order number, pickup instructions, accepted/scheduled status, and promised time. Send an itemized email receipt. If payment succeeds but fulfillment eligibility is no longer valid, show a clear “Restaurant review required” message, alert staff, and resolve or refund the payment without sending an unattended production ticket. If an additional successful payment nevertheless arrives for an already accepted order, flag a financial exception and resolve the extra payment; keep the original cooking workflow moving and do not print another original KOT.

### 6.5 Track and collect

A secure, unguessable link shows the customer their order progress and receipt without requiring registration. Expose customer-friendly statuses, such as confirmed, scheduled, preparing, ready, completed, or cancelled. Internal printer failures belong on the staff interface; the customer receives the consequence and support information where relevant.

Staff mark ready and then completed at handoff. An email ready notification is useful but cannot be the only route to status information. Customers requesting a change or cancellation contact the restaurant through owner-approved details; launch does not promise unrestricted self-service cancellation after cooking has started.

## 7. Restaurant and kitchen workflow

### 7.1 Opening and live service

At opening, staff confirm printer readiness, paper, bridge connectivity, the order board, current menu availability, and preparation estimates. The dashboard distinguishes “Accepting online orders,” “Paused,” “Closed,” and “Fulfillment attention required.” Staff can mark items/modifiers sold out immediately and add a pause reason with a customer-facing message. At closure or an emergency fulfillment cutoff, actively expire affected unpaid checkout sessions and reconcile any payment racing with expiry; pausing the website alone cannot invalidate a payment page already open.

The active order board groups accepted ASAP orders, future scheduled orders, preparation, ready pickups, and exceptions. New accepted orders produce a persistent visual alert and configurable sound. A muted browser must not hide the order from the queue. Reconnecting refreshes authoritative status rather than trusting an old screen.

### 7.2 Automatic kitchen printing

For an eligible paid ASAP order, the system creates the original KOT automatically. Printing must continue even if the customer closes their browser or the manager closes the dashboard. This requires the cloud application, durable print jobs, and a continuously running on-site bridge or a separately qualified cloud-print adapter.

The KOT includes restaurant name, a large order number, pickup type, accepted time, promised time, quantities, dish names, chosen modifiers, preparation notes, allergy flag, and ticket type. Prices and payment details are normally omitted from the kitchen copy. A customer receipt includes monetary breakdown and the approved business details instead.

For scheduled orders, reserve capacity and issue the customer receipt immediately after payment. Release the production KOT at the calculated preparation time. An optional immediate summary must be prominently marked **HOLD — NOT A COOKING TICKET** and must never be counted as the production ticket. Changes to preparation time must not cause an already released ticket to print again.

The system distinguishes queued, sent/delivered to the device path, device-confirmed where supported, and staff acknowledgement. Sending bytes to a printer is not proof that a legible ticket emerged. The interface must use the strongest status the qualified hardware can actually provide.

### 7.3 Exceptions and safe reprints

The bridge polls approximately every two seconds, reports health every fifteen seconds, and is considered offline after forty-five seconds without a heartbeat. A due print job exceeding thirty seconds raises a staff alert; an unresolved problem at two minutes escalates to the configured manager channel. These are proposed operational defaults, adjustable after real-device trials.

When a failure definitely occurs before output, the same logical job can retry. If output might already have occurred but acknowledgement was lost, its status becomes unknown and automatic resend stops. An expired worker lease or bridge restart is not proof that no paper printed and must not trigger blind resend. Staff check the printer and active tickets. If a replacement is needed, the manager issues a separate, audited copy prominently marked **REPRINT**, linked to the original order and ticket.

The product must not promise exactly-once physical printing. Its promise is durable job tracking, duplicate protection where evidence permits, and visible resolution of uncertain outcomes. New checkout pauses when no healthy fulfillment channel remains. A manager may temporarily authorize KDS-only service with an expiry and reason, provided the kitchen is actively monitoring the display. Existing paid orders remain visible and recoverable.

### 7.4 Cancellations, refunds, and changes

Cancellation and refund are separate operations. A cancelled order is not described as refunded until Stripe confirms the refund result. A partial refund does not silently cancel cooking or alter an already printed instruction. Staff must explicitly coordinate any fulfillment change with the kitchen.

Before an unsent KOT is released, cancellation prevents production dispatch. If dispatch has started or paper may already exist, send a clearly labeled cancellation notice and require kitchen acknowledgement. Cancellation cannot erase what a cook has already seen.

Managers can request full or partial refunds, select a reason, and view pending/succeeded/failed outcomes. The interface prevents refunds exceeding the remaining refundable amount and repeated submission creating duplicate refunds. Refunds preserve original line, tax, fee, and payment snapshots. Bank processing time is not represented as instantaneous customer receipt of funds.

Paid item selections are immutable in the launch flow. Additional food requires a new paid order; substitution or partial cancellation requires an explicit staff resolution recorded against the original order. A full paid-order editing workflow is a separate scope decision because it needs revised totals, payment handling, and kitchen change tickets.

## 8. Menu, configuration, and reporting

Administrators manage categories, item visibility, images, descriptions, prices, modifiers, ordering windows, daily limits where used, and sold-out state. Updates apply to new quotes and must not rewrite accepted orders. Ingredient-level inventory is out of scope; simple item limits and kitchen capacity are supported.

Capacity should be configurable per pickup slot using an agreed unit such as order count or workload points. An active payment reservation occupies capacity until payment resolution or expiry. Concurrent customers cannot both consume the final available capacity unit. Expired sessions, abandoned carts, and invalid attempts release reservations through controlled reconciliation.

Reports include orders, gross food sales, discounts if enabled, taxes, gratuities, charges, refunds, and net collected amounts for a selected restaurant-local date range. Distinguish sales from Stripe settlement/payout figures. Export access is permission-controlled, and financial totals reconcile to stored transactions rather than browser analytics. Operational reporting includes late orders, payment exceptions, printer downtime, reprints, unresolved tickets, and cancelled orders.

## 9. Quality, privacy, and operational requirements

| Area | Product requirement |
| --- | --- |
| Reliability | Proposed ordering API availability target of 99.9% monthly; every paid order and unresolved print job durably recorded |
| Performance | Quote response p95 below 500 ms at the agreed baseline load; customer screens remain usable on typical mobile connections |
| Initial sizing assumption | 300 paid orders/day, peak 30 orders/15 minutes; load test 100 concurrent sessions and 20 checkout starts/minute |
| Accessibility | WCAG 2.2 AA product target, including keyboard checkout, visible focus, form errors, readable contrast, and status announcements |
| Security | Stripe-hosted card collection, no raw card data in application logs/database, protected staff accounts, audited sensitive actions |
| Privacy | Minimum necessary personal data, restricted kitchen views, approved retention/deletion policy, clear customer privacy notice |
| Recovery | Proposed RPO at most 5 minutes and RTO at most 60 minutes, demonstrated through restore drills |
| Customer communication | Receipt, ready, cancellation, and refund messages are distinct; notification failure does not discard an order |

Applicable privacy, marketing-consent, accessibility, consumer, and tax obligations must be reviewed for the actual business before launch. The product accessibility target is not a claim that a particular legal threshold applies. Financial records and routine operational personal data need different, owner-approved retention schedules.

## 10. Release plan and acceptance gates

1. **Business setup:** approve menu, prices, modifiers, hours, policies, taxes, pickup windows, and role assignments; inspect the actual printer and network.
2. **Ordering foundation:** validate menu, cart, availability, quote totals, reservations, guest tracking, and admin controls.
3. **Payment and fulfillment:** integrate Stripe test mode, verified events, receipts, automatic acceptance, refunds, and reconciliation.
4. **Kitchen integration:** qualify the exact printer/driver/bridge combination; test readable tickets, cuts, long notes, restart, paper exhaustion, and unknown-output recovery.
5. **Staff rehearsal:** simulate busy service, concurrent final-slot purchases, cancellation during printing, scheduled releases, duplicate events, and network interruption.
6. **Controlled launch:** run a small approved service window, monitor each payment-to-kitchen journey, then expand after restaurant signoff.

Launch requires all P0/P1 requirements agreed for Phase 1 to pass the SRS acceptance suite. No live order should be enabled merely because a successful Stripe test payment or one sample ticket worked. A production payment/refund smoke test, with approved funds and an owner-designated tester, must be planned separately from this documentation task.

## 11. Main risks and mitigations

| Risk | Mitigation / owner |
| --- | --- |
| Existing printer cannot provide usable automatic integration | Hardware qualification before UI completion; technical lead and manager select a supported adapter |
| Paid order lost between payment and printing | Durable event inbox, transactional job creation, periodic reconciliation, visible exceptions; engineering |
| Duplicate physical ticket after power/network failure | Unknown-output state, staff verification, labeled reprint; engineering and kitchen lead |
| Kitchen becomes overloaded | Reserved capacity, preparation estimates, pause control, scheduled release; manager |
| Wrong totals or refunds | Approved tax profile, immutable snapshots, integer money calculations, test fixtures and reconciliation; accountant and engineering |
| Staff misunderstand printer status | Distinguish delivery, confirmation, and acknowledgement; rehearse recovery; operations lead |
| Brand or allergy promise exceeds evidence | Owner-approved wording and explicit contact workflow; owner |
| Customer waits during a printer outage | Alerts, controlled KDS fallback or ordering pause, direct staff resolution; shift manager |

## 12. Decisions and inputs required before launch

| Decision / input | Proposed baseline or required evidence | Responsible party |
| --- | --- | --- |
| Legal business/receipt details | Approved trading/legal names, contact details, registration information where applicable | Owner/accountant |
| Brand content | Final logo, food assets, approved halal wording and any certification evidence | Owner |
| Menu | Full item list, prices, modifier rules, tax categories, allergen information and sold-out rules | Owner/chef |
| Service hours | Weekly hours, holiday exceptions, cutoff, booking horizon | Manager |
| Pickup promise | Slot interval, lead time, capacity units and limits | Kitchen lead |
| Acceptance policy | Automatic acceptance of valid paid orders; exception resolution responsibility | Owner |
| Scheduled ticket policy | Release at preparation time; optional clearly marked HOLD summary | Kitchen lead |
| Printer | Exact model, interface, firmware, paper width, driver, placement, spare-roll and power plan | Technical lead/manager |
| Payments | Stripe account ownership, business verification, payment methods and receipt settings | Owner |
| Taxes and gratuities | Written tax configuration and refund/rounding examples; gratuity policy | Accountant |
| Refund/cancellation policy | Cutoff, partial refund permissions, customer wording, escalation | Owner/manager |
| Fallback and alerts | Authorized KDS-only approvers, expiry, manager recipients, response coverage | Manager |
| Privacy and retention | Approved notice, retention periods, access/deletion contact, processor review | Owner |
| Delivery | Disabled until service area, fees, courier operations and failure policies approved | Owner |
| Launch ownership | Named operational owner, technical support owner, rollback authority | Owner |

These inputs are implementation and launch gates. They do not prevent using this draft to estimate and plan the project.

## 13. Reference material

Official material consulted for the overall specification package on 18 November 2026; verify applicable versions and business configuration during implementation:

- [Stripe — Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe — Webhooks](https://docs.stripe.com/webhooks)
- [Stripe — Refund and cancel payments](https://docs.stripe.com/refunds)
- [Canada Revenue Agency — GST/HST rates](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html)
- [Canada Revenue Agency — Ontario point-of-sale rebate on prepared food and beverages](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/gi-064/harmonized-sales-tax-ontario-point-sale-rebate-on-prepared-food-beverages.html)

The operational timings, architecture, release boundaries, and success criteria above are proposed Wok & Chop product decisions rather than claims made by those sources.
