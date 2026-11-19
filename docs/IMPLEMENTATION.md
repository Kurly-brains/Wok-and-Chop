# Wok & Chop implementation status

Date: 18 November 2026. Source requirements: [AGENT.md](../AGENT.md), [PRD.md](../PRD.md), [SRS.md](../SRS.md) and [ARCHITECTURE.md](../ARCHITECTURE.md), copied from the supplied requirements pack without changing that original pack.

This delivery is a working design preview and an engineering foundation, not a restaurant launch. The 37 lunch dishes and their initial $13.99 prices now come from the owner's supplied lunch menu. Generated imagery, demo promotions and operational orders remain synthetic; nine legacy sample dishes remain internally for saved-cart compatibility. Public customer copy uses the owner's requested “Online ordering opens soon” wording; this does not enable checkout. Staff/kitchen screens retain their preview boundary. No actual order, charge, refund, email or kitchen ticket is created. Production payments and fulfillment remain disabled.

The user's subsequent account request adds a real local PostgreSQL-backed customer registration/sign-in/session/logout service. Guest access remains available. This is separate from staff authorization and transactional ordering, which remain incomplete. See `LOCAL-ACCOUNTS.md` for startup, endpoint contracts, tests and explicit production boundaries. Account records are real local development records; operational orders remain synthetic and menu editing remains browser-local.

The subsequent promo-code request adds WOK10 and DEMO5 as explicit preview fixtures. They reprice selections against the catalog, enforce minimums/caps, and cannot apply without preview mode. This does not approve live promotions or their production tax/redemption rules. The customer site has separate home, menu, story, visit, account and privacy pages; staff and kitchen remain separate synthetic workspaces.

The latest accepted presentation preserves the original red homepage hero and category composition, with pure-white site surfaces and tighter spacing. “Chinese roots. Hakka soul.” is a compact text-only intro with its noodle artwork removed. One separate lower section retains four standalone Chinese-food stories with no prices, lunch labels or order buttons. The latest requested story interaction is an infinitely looping, freely draggable track with partial neighbouring cards and navigation controls, without a percentage or progress bar. The Menu page has a full-width food-photo banner, outlined category filters and a four-column desktop/two-column mobile dish grid. Normal photos and cutouts are supported; an added dish uses deep-red card highlighting, a checkmark and quantity derived from actual bag contents. Option selectors remain in the choose-dish modal, all 37 source lunch dishes/modifiers remain intact, and missing photos retain a graceful fallback. The local `/staff/menu/` editor continues to control lunch details, current prices, availability, heat/peanut markers and photo/cutout images. Browser-local overrides do not constitute production staff authorization or server-published menu persistence. See [the lunch and presentation brief](LUNCH-MENU.md).

The domain/lunch/promotion/catalog/cart suite passed all 33 tests on 18 November 2026. The five added cart regressions cover unavailable-line persistence, failed-write fallback, recovered cross-tab updates, blocked reads and validated repricing. The existing tests cover source lunch data/modifiers, preview-only promotions and catalog overrides. Shared package typechecking and scoped lint also passed. These checks do not establish authenticated administration, production pricing authority or shared restaurant storage.

The primary implementation agent verified the white photo grid, cart-derived added-card state, continuous FoodStories dragging across a loop seam, the styled bag's quantity/removal/promo/review flow and smooth close/focus return, and mobile dish-customizer fit. Account panel styling was visually checked. Final desktop/mobile branding QA passed for the supplied BOX/Horizontal/Favicon assets, exact `#c90109` primary red, square logo panel, compact spacing and horizontal-logo fit after scrolling. Root `pnpm build` and `pnpm lint` passed after all source changes, alongside the 33 passing tests. These local preview checks do not enable live ordering or payments. Exact browser observations, including arithmetic and drag measurements, are recorded in [UI acceptance notes](UI-ACCEPTANCE.md).

## Implemented backend boundary

- NestJS API with loopback development startup, separate liveness/readiness, pickup-only availability and fail-closed quote/checkout/webhook endpoints.
- Unavailable operations respond 503; no redirect or browser payment claim can create a paid order. A provider webhook is not acknowledged as accepted without durable verification.
- PostgreSQL migration foundation with independent payment/fulfillment/refund/print state enums, active-attempt uniqueness, provider deduplication, canonical-capture uniqueness, immutable order revisions, semantic outbox keys, original KOT uniqueness, linked reprints and immutable print payloads.
- API safety tests exercise live HTTP responses for forged payment claims, unavailable checkout/webhooks and absent protected mutation routes.
- Development infrastructure definitions and explicit worker/bridge/observability boundaries.

Verification on 18 November 2026: `pnpm --filter @wok/api build` and `pnpm --filter @wok/api typecheck` passed. `pnpm --filter @wok/api test` passed all five live HTTP safety tests. The tests establish the fail-closed development boundary; they do not exercise an implemented Stripe, database persistence, staff authentication or printer integration.

After the customer-account extension and security review, the same build/typecheck passed and all ten tests passed with `AUTH_TEST_DATABASE_URL` configured (no skips), including real PostgreSQL account/session checks, session fixation/expiry/revocation, origin/CORS checks, production/configuration guards and DNS-rebinding Host rejection. The added persistence applies to customer accounts only; it does not establish an ordering/payment ledger. Frontend account state uses response sequencing, validated server responses and immediate successful-login/logout updates; a failed background refresh does not falsely sign the customer out.

## Requirements and evidence boundaries

| Requirements | Current evidence                                                                              | Remaining acceptance                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–008   | Owner lunch source imported; shared catalog/cart and browser-local photo/cutout editor        | Confirm operating content, server availability/repricing, authenticated server-persisted menu management                                          |
| FR-009–017   | Pickup-only and ordering-disabled API; scheduling domain work                                 | Approved hours/capacity, atomic reservations, holiday/DST integration and scheduled worker                                                        |
| FR-019–024   | Shared money/validation rules; schema attempt/idempotency constraints; API denies live quotes | Approved tax fixtures, server pricing, database locking, immutable Checkout snapshot and provider timeout recovery                                |
| FR-025–033   | Checkout/webhooks remain unavailable; inbox/outbox/capture schema                             | Stripe test integration, raw signature verification, durable ingress, atomic acceptance, duplicate/late payment and recovery suites               |
| FR-034–040   | Synthetic staff/KDS preview                                                                   | Authenticated live orders, guest isolation, receipts, notifications, reporting and state enforcement at API boundary                              |
| FR-041–054   | Schema print identities/fences, local SQLite diagnostic journal, simulated spool, opt-in LAN hardware test | Authenticated production dispatch gate, qualified device, UNKNOWN/cancellation/reprint acceptance |
| FR-055–059   | Refund/audit schema foundation                                                                | Authorized refund budget transactions, provider reconciliation, admin and privacy workflows                                                       |
| NFR-001–014  | Local checks reported separately; API fails closed                                            | Full accessibility/security/device tests, load measurements, monitoring, secrets/access control, verified backup/restore and operational training |

The up migration, constraint checks in `packages/database/test-foundation.sql`, and down migration passed on an isolated PostgreSQL 18.3 instance on 18 November 2026. Checks covered active-attempt and canonical-capture uniqueness, extra noncanonical capture retention, original KOT and provider-event deduplication, required reprint reason, immutable order/print snapshots, and semantic outbox uniqueness. This is not evidence of concurrent application/provider/physical-print acceptance. Re-run on pinned PostgreSQL 17.12 before deployment. UI state in browser storage is not the authoritative order ledger. The staff preview is intentionally accessible because it contains only synthetic examples; production staff functionality requires API-enforced roles and MFA.

## Required owner and integration inputs

Confirm the imported lunch menu/options and obtain other menu content, approved photos, full business hours/holiday cutoffs, telephone/support details, prep/capacity rules, accountant-approved effective tax/refund fixtures, tip/refund/privacy policies, Stripe environments, exact printer/firmware/driver and bridge hardware, notification provider, retention and support owners. The supplied noon–3 p.m. lunch window and holiday exclusion do not implement a holiday calendar or general opening-hours policy. The restaurant timezone remains America/Toronto and currency CAD. Delivery remains disabled.

## Next implementation slices

1. Qualify printer hardware and establish Stripe sandbox/webhook test environments.
2. Connect PostgreSQL, least-privilege roles and reversible migration tooling. Implement validated menu/quote/capacity transactions with tampering and last-unit concurrency tests.
3. Implement durable Checkout creation, verified inbox, canonical acceptance/outbox and provider reconciliation. Include uncertain response, duplicate/out-of-order and late-payment tests.
4. Add staff authentication/roles, secure guest tracking and authoritative UI connections.
5. Integrate the diagnostic journal with authenticated production leases, fencing and dispatch gates. Exercise physical faults and supervised UNKNOWN recovery.
6. Complete scheduled releases, cancellations, refunds, notifications, retention, reporting, load/restore drills and training. Obtain explicit launch signoff only after acceptance evidence exists.

## Reference verification

NestJS 11.2.11 packages were verified from the npm registry, with the supported v11 workflow checked against [NestJS v11 first steps](https://docs.nestjs.com/v11/first-steps). The installed Node runtime was 24.14.0. The local printer diagnostic sends a fixed ASCII/line-feed specimen for ESC/POS hardware qualification. The station runbook records the supported test, evidence levels and physical checks. [Printer diagnostics and qualification](../apps/print-bridge/README.md)

Stripe SDK/API selection remains open. Verify official provider documentation when each integration is built, and record its version and environment in the acceptance report.
