# Wok & Chop

A Chinese restaurant website for Wok & Chop, with a rotating tabletop hero, an owner-supplied lunch menu, separate story and visit pages, and PostgreSQL-backed local delivery and restaurant workspaces. The restaurant address is **790 Kanata Ave, Unit M2A, Kanata ON**. Currency is CAD. Restaurant business time is `America/Toronto`.

**Current status: design preview and engineering foundation.** The 37 lunch dishes, their $13.99 CAD base prices and stated lunch terms come from the owner's supplied menu. Generated imagery, demo promo codes and operational orders remain demonstration content; nine older sample dishes are retained internally for saved-cart compatibility. Customer accounts can persist in a real local PostgreSQL database when the account service is running. The application does not accept real orders, charges, refunds or kitchen print jobs.

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

This requires the PostgreSQL 18 tools at `C:\Program Files\PostgreSQL\18\bin`. The script creates its own cluster under `ops/.local/postgres` on loopback port 55440, applies the account migration, builds the API and starts it at `http://127.0.0.1:4000`. It does not alter an existing system database service. Generated credentials and database files remain in ignored local state. The browser API base defaults to that address; `NEXT_PUBLIC_API_BASE_URL` is available for an explicitly configured development setup.

If port 3000 is in use, start the web app with `pnpm --filter @wok/web dev --port 3001` and the API with `& .\ops\start-local-accounts.ps1 -WebPort 3001`.

Stop the foreground web/API processes with Ctrl+C. The task-owned database remains available for the next preview; see [local account startup and shutdown](docs/LOCAL-ACCOUNTS.md) for the exact database stop command, API contracts and security boundaries. Guest browsing and cart building do not require an account.

## Pages and interactions

| Route          | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `/`            | Original red hero/categories plus a separate lower draggable Chinese-food story section |
| `/menu/`       | Food-photo banner, category filters and lunch dish grid with bag-driven added state     |
| `/our-story/`  | Restaurant story and Hakka Chinese positioning                                          |
| `/visit/`      | Supplied location and directions                                                        |
| `/delivery/`   | Guest home delivery checkout, server-priced review and private tracking                 |
| `/account/`    | Account sign-in and linked delivery and pickup receipts                                 |
| `/staff/`      | Manager sign-in, delivery desk, order history, and kitchen and driver slips             |
| `/staff/customers/` | Manager-only customer directory and individual order lookup                         |
| `/staff/reports/` | Manager-only delivery volumes, dishes, timing and promotional activity                |
| `/staff/menu/` | Manager menu publishing for lunch details, prices, availability and photo/cutout images |
| `/kitchen/`    | Manager kitchen display for preparation and driver handoff                             |
| `/staff/printer-guide/` | Printer setup, virtual spool test, and physical test instructions                |
| `/staff/training/` | Separate sample order board and virtual printer diagnostics                           |
| `/privacy/`    | Current preview/account data handling and outstanding production policy inputs          |

The local home delivery flow stores test orders and their status changes in PostgreSQL. Guests receive a private tracking code. Before live operation, configure the approved service area, delivery charges, tax, payments and driver handoff. [Local delivery guide](docs/LOCAL-DELIVERY.md)

The [ordering feature checklist](docs/ORDERING-FEATURES.md) records which restaurant workflows are available in the local preview and what each remaining launch feature requires.

The demo codes are `WOK10` (10% off food with a $20 minimum, capped at $15) and `DEMO5` ($5 off food with a $35 minimum). Apply one at a time. The API recalculates each code against the server catalog for local test orders.

The red homepage hero (`#c90109`) layers a rotating tabletop and overhead dishes in front of the headline. The box logo appears before scrolling, the horizontal logo after scrolling, and the supplied favicon identifies the site. Four food stories run in a freely draggable carousel with neighbouring cards and arrow controls. Completed browser, branding and build checks are recorded in [UI acceptance notes](docs/UI-ACCEPTANCE.md).

The Menu page has a full-width food-photo banner, outlined category filters and a dish-photo grid: four columns on desktop and two on mobile. Its 37 lunch entries cover Chicken (15), Beef (10), Fish (6), Vegetarian (4), and Rice & noodles (2). The supplied offer is noon–3 p.m., excluding holidays, with jasmine rice, a vegetable spring roll, and soup of the day or pop. Fried-rice substitution adds $2.50; dry preparation adds $1.00 for the applicable categories. See [the lunch source and presentation brief](docs/LUNCH-MENU.md) for the exact data and editing boundaries.

Dish cards support ordinary photos and transparent cutouts, with useful text when no photo is assigned. After adding a dish, its card shows a deep-red highlight, checkmark and the actual quantity in the bag; this state clears when that quantity returns to zero. Dish option selectors remain in the choose-dish modal. Required choices, current prices and bag state remain independent of the visual redesign.

With the local API running, sign in to `/staff/menu/` as a restaurant manager to publish lunch text, price, visibility and photo/cutout changes. The customer menu and server delivery quotes use the published PostgreSQL catalog. Reset restores the imported lunch defaults. Apply the local menu migration through the startup script before using the editor.

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

`pnpm build` builds the Next.js static site into `apps/web/out` and compiles the API into `apps/api/dist`. A successful build is not evidence of restaurant launch readiness. Static hosting does not supply the local account API. The current API deliberately refuses a production environment; it needs a separate production implementation and security review before deployment. `pnpm preview` is a local Next.js development preview, not a production server command.

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
