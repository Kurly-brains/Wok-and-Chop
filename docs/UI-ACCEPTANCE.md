# UI acceptance notes

## Delivery management

The authenticated delivery desk at `/staff/` lists active requests and paginated history. The kitchen display at `/kitchen/` groups active tickets by preparation stage and shows dishes, quantities, modifiers and kitchen notes. Each status change sends the version the operator saw. After a conflicting write both screens fetch the current ticket. Customer contact and drop-off details stay in the manager view.

Browser checks with controlled API responses covered manager sign-in, multiple active pages, delivery fee presentation, kitchen preparation, a conflicting status update, dispatch, completion, history search, cancellation confirmation, sign-out and layout at 320 and 390 pixels.

## Restaurant training workspace

The practice board at `/staff/training/` and kitchen display at `/kitchen/training/` rehearse pickup orders. Start the local API and web app, then open both routes through the configured web origin. The **Shared training board** indicator means both displays are using the same local API. Without the API, a browser can use its own clearly labeled local training queue. If an established shared connection drops, the screen keeps the last shared snapshot and suspends writes until reconnection. Browser-only orders stay on their original board.

The loopback API stores training tickets separately in SQLite at `~/.wok-and-chop/training/operations.sqlite`. Set `TRAINING_DATABASE_PATH` to choose another rehearsal database. Each write uses a transaction and a client request ID. A reused request ID can repeat the same command safely. A conflicting action receives HTTP 409. Submitting a shared order atomically saves its original training slip alongside the ticket in SQLite. Deliberate copies have their own saved payload and copy number. Staff can open and download both from the order details. These slips stay separate from physical printer dispatch, live orders and customer payments. Printer diagnostics have their own explicit test controls.

### Recorded checks

- In separate browser profiles, staff entered a two-dish ticket with an upgraded side, quantity two, a dish note, an order note and an allergy alert. A 390-pixel kitchen display received it and accepted, started, readied and completed it. The staff history contained all four actions after reload. Neither page produced a runtime error, and the mobile display fit the viewport.
- API integration tests in `apps/api/test/training-board.test.ts` exercise concurrent requests, request replay, stage validation, modifier pricing, immutable original and reprint payloads, content preservation, service pause, scheduled holds, copy protection, unapproved origins and durable reads from a second database connection. Run `pnpm --filter @wok/api test` for the API suite.
- A held scheduled ticket stays out of preparation. A ticket with unknown print evidence requires an explicit staff check and acceptance before preparation. Kitchen acceptance leaves its original printer evidence intact.

These checks exercise synthetic training workflows for FR-036 through FR-038 and selected print-exception and fallback behavior. Live order authorization, scheduled release, on-site printer qualification and restaurant launch acceptance are separate.

## Customer editorial revision — recorded checks

After changing Story and Visit to unframed layouts and overlapping food compositions:

- `pnpm --filter @wok/web typecheck` passed.
- `pnpm exec eslint apps/web/components/story-content.tsx apps/web/components/visit-content.tsx` passed without warnings.
- Filesystem inspection confirmed the referenced `chicken-cutout.webp` and `spring-rolls-cutout.webp` assets exist in `apps/web/public/images`.

These checks do not establish browser rendering, alpha-edge quality, responsive layout, or accessibility conformance. No additional browser tests were performed for this revision. The accepted visual direction is recorded in [DESIGN-DIRECTION.md](DESIGN-DIRECTION.md).

## Photo-grid revision — recorded browser checks

The current direction uses a pure-white site, a full-width food-photo Menu banner, outlined category filters and four dish columns on desktop/two on mobile. All 37 lunch dishes and source modifiers remain. Normal photos and cutouts are supported. Adding a dish produces a deep-red card highlight, checkmark and actual bag quantity. The home introduction is compact and text-only, with its noodle artwork removed; the original red hero/categories and independent draggable FoodStories remain. See [LUNCH-MENU.md](LUNCH-MENU.md).

Browser observations on 18 November 2026, reported by the primary implementation agent for the photo-grid revision:

- At 1440 px the menu had four dish columns; at 390 px it had two.
- No broken images or mobile horizontal overflow were observed.
- Butter Chicken was added through its required modifiers. Its card became red with a checkmark and quantity one.
- Increasing that dish's quantity in the bag to two updated the card. Removing it restored the normal card while preserving an existing Hakka line.
- The Fish filter displayed six dishes.
- Web lint and typechecking passed.

The domain/lunch/promotion/catalog/cart suite passed all 33 tests, including five new cart-persistence regressions. Earlier hover/focus-menu observations are superseded and are not acceptance evidence for the photo grid. Final build and branding results are recorded below.

## Story, bag and customizer — recorded browser checks

The primary implementation agent reported these checks on 18 November 2026:

- **FoodStories:** full-viewport, infinitely looping free drag with partial neighbours and no position/progress indicator. Four consecutive requested 600 px desktop drags, including the loop seam, produced measured travel of 600, 600, 600 and 600.25 px. An 80 px drag moved 80 px. On mobile, track and document widths were both 375 px, with no horizontal overflow or broken images. Its four editorial stories remain independent of menu editing and have no commerce controls.
- **Bag drawer:** the styled drawer's 280 ms close transition, Escape/backdrop dismissal and focus return were tested. Karachi Chicken with Dry preparation was $14.99 each; quantity two plus an existing $14.95 line gave $44.93. WOK10 deducted $4.49 for a $40.44 food total. Removing Karachi restored $14.95, invalidated the discount to zero with a message, and left Remove code usable.
- **Pickup review:** the footer-button reuse issue that skipped the pickup-review step was fixed. Reading `pickupTime` through FormData retained 12:30 and displayed the correct review preference. These remain preview preferences; nothing is reserved or ordered.
- **Dish customizer and account:** rounded stone-white choice controls fit a 370 px mobile width without overflow. The softer account panel was visually verified.

## Final branding and build — recorded checks

The primary implementation agent confirmed final desktop and mobile branding QA: the exact supplied BOX PNG appears before scrolling, the supplied Horizontal PNG fits after scrolling, and the supplied favicon is used. Primary red is `#C90109`, the logo panel has 0 px corner radius, desktop navigation has a 20 px gap, and logo boxes measure 140 × 118 px on desktop and 96 × 90 px on mobile.

Root `pnpm build` and `pnpm lint` passed after all source changes. The domain/lunch/promotion/catalog/cart suite passed 33/33 tests. These results complete the recorded preview build and branding checks; they do not establish comprehensive accessibility or every separate operations manual scenario. Live ordering, payments, durable order submission and kitchen dispatch remain unavailable.
