# Wok & Chop

A Chinese restaurant website for Wok & Chop, with a rotating tabletop hero, an owner-supplied lunch menu, separate story and visit pages, and PostgreSQL-backed local pickup and restaurant workspaces. The restaurant address is **790 Kanata Ave, Unit M2A, Kanata ON**. Currency is CAD. Restaurant business time is `America/Toronto`.

**Current status: storefront preview with live Uber Eats links.** The 37 lunch dishes, their $13.99 CAD base prices and stated lunch terms come from the owner's supplied menu. Local PostgreSQL persists preview pickup orders and accounts. The hosted preview offers phone ordering for direct pickup. Uber Eats handles orders placed on its platform.

## Run the website

Use Node.js 24.14.0 and pnpm 10.33.2, the versions selected for this workspace. From PowerShell:

```powershell
Set-Location -LiteralPath 'E:\WOK & CHOP\wok-and-chop'
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The storefront, cart, promo demonstration and synthetic staff screens work without the account API. Use `127.0.0.1` consistently: `localhost` is a different browser origin for the account service.

In a second PowerShell terminal, start persistent local registration and sign-in:

```powershell
Set-Location -LiteralPath 'E:\WOK & CHOP\wok-and-chop'
& .\ops\start-local-accounts.ps1
```

This requires the PostgreSQL 18 tools at `C:\Program Files\PostgreSQL\18\bin`. The script creates its own cluster under `ops/.local/postgres` on loopback port 55440, applies the account migration, builds the API and starts it at `http://127.0.0.1:4000`. It does not alter an existing system database service. Generated credentials and database files remain in ignored local state. The browser uses same-origin `/v1/` routes. In standalone development the Next.js route handler forwards them to the loopback API. `NEXT_PUBLIC_API_BASE_URL` is available as an explicit browser-side override for a separate development setup.

If port 3000 is in use, start the web app with `pnpm --filter @wok/web dev --port 3001` and the API with `& .\ops\start-local-accounts.ps1 -WebPort 3001`.

Stop the foreground web/API processes with Ctrl+C. The task-owned database remains available for the next preview; see [local account startup and shutdown](docs/LOCAL-ACCOUNTS.md) for the exact database stop command, API contracts and security boundaries. Guest browsing and cart building do not require an account.

## Vercel Services preview

Use the repository root for the Vercel project and select the **Services** framework. [Vercel Services setup](https://vercel.com/docs/services)

```powershell
pnpm dlx vercel@59.11.7 dev --local --listen 127.0.0.1:3100
```

The root [Vercel configuration](vercel.json) makes `web` public and keeps `api` internal. Browsers use `/v1/` on the website origin. The Next.js route handler forwards the hosted menu and availability reads through the `WOK_API_URL` binding injected by Vercel. Leave that variable unset in project settings.

The hosted NestJS entry point serves the packaged menu and reports first-party web checkout as closed. The full local customer, pickup and staff workflows remain available through the standalone local commands above. The print bridge runs on restaurant hardware.

## Pages and interactions

| Route          | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `/`            | Rotating tabletop hero, pickup and delivery choices, and a draggable food story section |
| `/menu/`       | Pickup and Uber Eats links, category filters, lunch dish grid and animated ordering FAQs |
| `/our-story/`  | Restaurant story and Hakka Chinese positioning                                          |
| `/contact/` and `/visit/` | Contact form, location and directions                                      |
| `/order/`      | Pickup and Uber Eats delivery choices, menu preview and full table request form        |
| `/offers/`     | Guest signup and email preferences for restaurant offers                                 |
| `/pickup/checkout/` | Guest pickup checkout, server-priced review and private tracking in local preview  |
| `/pickup/tracking/` | Private pickup lookup, status timeline and order details                               |
| `/delivery/`   | Redirects to Wok & Chop on Uber Eats                                                     |
| `/delivery/tracking/` | Private tracking for historical direct delivery orders in local preview          |
| `/account/`    | Guest ordering and tracking, customer sign-in, profile and linked order history         |
| `/staff/sign-in/` | Dedicated restaurant manager sign-in and password recovery                           |
| `/staff/overview/` | Manager overview for pickup activity, trends, current queue and popular dishes       |
| `/staff/`      | Pickup queue, order history and kitchen slips                                          |
| `/staff/customers/` | Manager-only customer directory and individual order lookup                         |
| `/staff/reservations/` | Manager reservation decisions, date and time changes, and contact inbox          |
| `/staff/reports/` | Manager-only delivery volumes, dishes, timing and promotional activity                |
| `/staff/marketing/` | Manager-only offer composer, audience count and campaign history                    |
| `/staff/menu/` | Manager menu publishing for lunch details, prices, availability and photo/cutout images |
| `/kitchen/`    | Manager kitchen display for preparation and pickup handoff                              |
| `/staff/printer-guide/` | Installed Windows queue status, test slip and recent print jobs                 |
| `/privacy/` and `/terms/` | Data handling, cookie preferences and restaurant ordering terms            |

The direct pickup flow stores test orders and their status changes in PostgreSQL. Guests receive a private tracking code, and staff can mark orders in preparation, ready and picked up. Direct pickup uses payment at collection. Choose Pickup in the Uber Eats listing when collecting an order placed there. [Local ordering guide](docs/LOCAL-DELIVERY.md)

Every staff and kitchen page checks the current manager session before it renders. The public footer links to staff sign-in. The workspace sidebar appears after manager sign-in.

The Order desk badge shows the active direct-order count. While a staff page is open, the badge refreshes every five seconds and new incoming tickets trigger an alert. In the kitchen, staff can drag a ticket to an adjacent stage or use its action buttons. Moving a pickup back asks for confirmation and records the correction on the order.

### Table requests, contact messages and email

Guests can ask for a table on `/order/#book-a-table` or fill out the message form on `/contact/`. Requests use Toronto time and await a staff decision. In `/staff/reservations/`, managers can confirm, change the date, time and party size, decline, or cancel a booking. The contact inbox keeps a record of each submission. The local API accepts form submissions. The hosted preview displays the forms with submission disabled.

In **Reservations → Booking settings**, managers can set the daily first and last request times, pause online requests, and close individual dates with guest notices. Review booked tables before closing a date. Existing bookings can be rescheduled or cancelled individually.

In **Menu editor → Guest options for this dish**, managers can set or reset the price of each enabled choice. Published prices update the dish and the server's pickup quote, including when an option costs $0.

The local API sends from `info@wokandchop.ca` through `smtp.hostinger.com` on port `465` with TLS. To enable real sending, create the ignored `ops/.env` from `ops/.env.example`, set `WOK_SMTP_PASSWORD` to the Hostinger mailbox password and restart the local API. Staff receive new reservation, contact and pickup alerts at `wokandchopottawa@gmail.com`. Guests receive booking acknowledgments and decisions, optional pickup status emails, and ten-minute one-time password-reset codes. [Hostinger email configuration](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/)

Without the password, the API retains form submissions and stores notification previews in PostgreSQL. Preview records stay outside the delivery queue when SMTP is enabled. The API retries queued messages after temporary SMTP failures. Password reset sends codes directly, clears existing sessions after a successful reset, and requires a fresh code after an API restart. Use synthetic email addresses for automated checks.

### Email offers

Guests sign up from **Email offers** in the footer and confirm their address from an email link. Staff use **Marketing** to preview an offer, review the subscriber count, and queue one email per confirmed address. Every offer includes the restaurant's contact information and an unsubscribe link. The queue checks consent again before sending. Campaign history records the number queued.

Offer signup and sending require the Hostinger password and `WOK_MARKETING_PUBLIC_URL`, the HTTPS origin serving the live confirmation and unsubscribe routes. The Vercel preview keeps those submissions disabled. `WOK_MARKETING_DAILY_LIMIT` defaults to 50 confirmation and offer messages per rolling 24-hour period. Set the allowance for the restaurant's Hostinger plan and leave capacity for order, booking and password reset emails. [Hostinger mailbox limits](https://www.hostinger.com/support/4625828-parameters-and-limits-of-hostinger-email/)

Before the first live campaign, test a confirmed signup and unsubscribe with an address controlled by the restaurant. Check the received message for SPF, DKIM and DMARC results, and verify the one-click unsubscribe headers are DKIM-signed. [Hostinger domain authentication](https://www.hostinger.com/support/8671319-set-up-a-domain-for-hostinger-email-manually/) · [Gmail sender guidelines](https://support.google.com/mail/answer/81126)

The [ordering feature checklist](docs/ORDERING-FEATURES.md) records which restaurant workflows are available in the local preview and what each remaining launch feature requires.

Guests can manage optional Google review photos from **Cookie settings** in the footer. Their choice persists in the browser. Essential storage supports the bag, sign-in and checkout.

### Kitchen printing on Windows

Connect the receipt printer to the PC running the local API and install the manufacturer's driver. Set `WOK_WINDOWS_PRINTER` in the ignored `ops/.env` to the exact queue name shown in Windows **Printers & scanners**, then restart the local API. In Staff, open **Printer setup** and send one marked test slip. Windows accepting the job and paper coming out are separate checks. The order desk provides a manual print action and a downloadable slip for active pickups. [Windows printer connection](apps/print-bridge/WINDOWS.md)

The demo codes are `WOK10` (10% off food with a $20 minimum, capped at $15) and `DEMO5` ($5 off food with a $35 minimum). Apply one at a time. The API recalculates each code against the server catalog for local test orders.

The red homepage hero (`#c90109`) layers a rotating tabletop and overhead dishes in front of the headline. The box logo appears before scrolling, the horizontal logo after scrolling, and the supplied favicon identifies the site. Four food stories run in a freely draggable carousel with neighbouring cards and arrow controls. Completed browser, branding and build checks are recorded in [UI acceptance notes](docs/UI-ACCEPTANCE.md).

The Menu page has a full-width food-photo banner, outlined category filters and a dish-photo grid: four columns on desktop and two on mobile. Its 37 lunch entries cover Chicken (15), Beef (10), Fish (6), Vegetarian (4), and Rice & noodles (2). The supplied offer is noon–3 p.m., excluding holidays, with jasmine rice, a vegetable spring roll, and soup of the day or pop. Fried-rice substitution adds $2.50; dry preparation adds $1.00 for the applicable categories. See [the lunch source and presentation brief](docs/LUNCH-MENU.md) for the exact data and editing boundaries.

Dish cards support ordinary photos and transparent cutouts, with useful text when no photo is assigned. After adding a dish, its card shows a deep-red highlight, checkmark and the actual quantity in the bag; this state clears when that quantity returns to zero. Dish option selectors remain in the choose-dish modal. Required choices, current prices and bag state remain independent of the visual redesign.

With the local API running, sign in to `/staff/menu/` as a restaurant manager to add a dish or publish price, visibility, photo and featured changes. The storefront and server pickup quotes read the same PostgreSQL catalog. Mark a dish Featured to promote it in the homepage and Order Online previews. Restoring the packaged defaults preserves dishes you have added. Apply the local menu migrations through the startup script before using the editor.

## Checks and builds

Run these from the repository root:

```powershell
node ops/sync-agent-instructions.mjs --check
pnpm --filter @wok/web exec next typegen
pnpm typecheck
pnpm test
pnpm test:integration
pnpm lint
pnpm build
```

Generate Next.js route types before a standalone typecheck on a fresh checkout. The domain suite covers lunch data, search, pricing, promotions, menu and cart behavior. API integration tests marked as PostgreSQL-backed run when `AUTH_TEST_DATABASE_URL` is set. To include them in the same PowerShell session:

```powershell
. .\ops\start-local-accounts.ps1 -DatabaseOnly
pnpm test:integration
```

The test database name must end in `_test`. The account tests use synthetic records and clean up their own account. A skipped account suite does not demonstrate working authentication. See [implementation evidence](docs/IMPLEMENTATION.md), [account evidence](docs/LOCAL-ACCOUNTS.md), [domain evidence](packages/domain/README.md), and [staff/kitchen acceptance notes](docs/UI-ACCEPTANCE.md) for the recorded checks and remaining acceptance work.

`pnpm build` builds the Next.js app into `apps/web/.next` and compiles the API into `apps/api/dist`. Pages are pre-rendered where possible. The `/v1/` route handler runs on the server so it can read the binding at request time. `pnpm preview` runs the standalone Next.js development preview.

The [GitHub Actions workflow](.github/workflows/ci.yml) installs the frozen lockfile, verifies synchronized agent instructions, generates route types, typechecks, runs domain and API tests, and builds both applications. Its disposable PostgreSQL service applies and checks the foundation schema plus the account migration, so account tests are enabled in CI. This workflow is prepared for a GitHub repository; a remote CI run has not been claimed. Action versions are pinned to verified commit hashes. Service authentication is intentionally confined to the disposable CI database; it is not a production database configuration.

## Repository boundaries

| Path                                          | Responsibility                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/web`                                    | Next.js customer site, account UI, local menu editor, synthetic staff board and KDS  |
| `apps/api`                                    | NestJS local customer accounts and fail-closed ordering/payment boundary             |
| `apps/worker`, `apps/print-bridge`            | Worker boundary and [local printer simulator, journal and LAN specimen test](apps/print-bridge/README.md) |
| `packages/domain`                             | Supplied lunch menu, money/modifiers, preview promotions, scheduling and state rules |
| `packages/contracts`                          | Strict request validation and typed event contracts                                  |
| `packages/database`                           | PostgreSQL schema foundation, account migration and constraint checks                |
| `packages/printing`, `packages/observability` | Ticket safety helpers and operational boundaries                                     |
| `tests/domain`                                | Domain, promotion and browser-local catalog checks                                   |
| `ops`                                         | Local account startup, development infrastructure and instruction synchronization    |
| `docs`                                        | Implementation status, account behavior and acceptance notes                         |

## Briefs and instruction synchronization

The original supplied briefs are copied into this repository so their relative links work: [PRD](PRD.md), [SRS](SRS.md), [architecture](ARCHITECTURE.md), [architecture essentials](ARCHITECTURE-ESSENTIALS.md), and [engineering instructions](AGENT.md). The original sibling requirements pack has not been changed. The subsequent account, demo-promotion, owner lunch-menu and local menu-editing requests extend the preview scope. The latest visual clarification preserves the original hero/categories and adds lower draggable food-story cards independently of the lunch menu. These changes do not approve production launch or a published menu administration service.

`AGENT.md` is the canonical repository instruction file. `AGENTS.md` is an exact byte-for-byte copy for runners that discover the plural filename. After an intentional update to `AGENT.md`, run:

```powershell
node ops/sync-agent-instructions.mjs
node ops/sync-agent-instructions.mjs --check
```

Commit both files together. CI fails if they drift. Do not independently edit the generated copy.

## Still required before live ordering

Confirm the imported lunch content/options and obtain any other menu content, approved photos, full business hours/contact details, preparation/capacity rules, accountant-approved tax cases, privacy/refund/tip policies, and merchant/printer/notification configuration before launch. The supplied lunch window is not a full opening-hours or holiday calendar configuration. Server pricing and reservations, durable order/payment persistence, Stripe Checkout and verified webhooks, staff roles/MFA, receipts and notifications, the worker, authenticated print bridge and physical printer qualification remain incomplete. Delivery is disabled. Local account persistence does not change those boundaries.

The schema and domain helpers are foundations, not proof of complete transaction, concurrency, recovery or hardware behavior. Follow the detailed remaining slices and acceptance requirements in [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) before taking payments or dispatching kitchen work.
