# Direct pickup and earlier deliveries

Customers choose direct pickup or Uber Eats on `/order/`. Use `/pickup/checkout/` to rehearse restaurant pickup. The loopback restaurant API saves unpaid pickup orders in PostgreSQL with a pickup receipt code. Guests can order without an account and pay at the restaurant when direct pickup launches. Use sample contact details during testing.

The public delivery link opens the Wok & Chop listing on Uber Eats. Uber Eats also has its own pickup option. For an earlier website delivery, use `/delivery/tracking/` and the original private code.

Start the local account service to apply the pickup and staff management migrations. The account service uses dedicated local development and test databases.

```powershell
& .\ops\start-local-accounts.ps1
```

The local API retains tracking, history and reorder endpoints for earlier delivery records. New delivery orders start on Uber Eats.

The server prices dishes and modifiers from its catalog. WOK10 and DEMO5 follow the existing preview promotion rules. The pickup test total includes applicable demo discounts and leaves taxes unconfigured. Each direct pickup gets a `P-` number.

## Requests and tracking

All endpoints use the prefix `/v1/auth`. For POST requests, send JSON from the configured storefront origin. Signed-in buyers and managers also send the existing HttpOnly account cookie.

| Request | Behaviour |
| --- | --- |
| GET `pickups/config` | Confirms direct pickup is available in the local preview. |
| POST `pickups/quote` | Prices the current basket and returns a quote fingerprint. |
| POST `pickups` | Confirms and stores a direct pickup order and returns a receipt and private code. |
| POST `admin/pickups` | Lets a manager record a guest pickup with the same quote and receipt workflow. |
| POST `pickups/track` | Returns the current status for a private pickup code. An optional number must also match. |
| GET `pickups/mine` | Returns one page of direct pickups for the signed-in customer. |
| GET `deliveries/config` | Reports first-party delivery checkout as closed. |
| POST `deliveries/quote` or `deliveries` | Returns HTTP 503 with a message directing the guest to Uber Eats. |
| POST `deliveries/track` | Accepts the private tracking code in the body. An optional number must also match. Returns food details and current status. |
| GET `deliveries/mine` | Returns one page of deliveries for the signed-in customer. |
| GET `deliveries/:id/reorder` | Returns reusable selections for a delivery owned by the signed-in customer. Validates current catalog availability and omits historical prices, notes, contact and address details. |
| GET `admin/deliveries` | Lists manager-visible orders with fulfillment type, contact and kitchen notes. Use `scope=active`, `scope=history`, or `scope=archived` and the returned `nextCursor` as `after`. |
| GET `admin/customers/:id/deliveries` | Lists delivery receipts linked to the selected customer in the manager directory. |
| GET `admin/delivery-reports` | Returns manager-only 7- or 30-day aggregates. Use `days=7` or `days=30`. |
| POST `admin/deliveries/:id/status` | Requires manager access and a valid `{expectedVersion,status}` command. A stale or invalid transition returns HTTP 409. |
| POST `admin/deliveries/:id/undo` | Corrects a pickup by returning to its previous status. Requires the current version and a reason. |
| POST `admin/deliveries/:id/note` | Updates the private manager note on a pickup. |
| POST `admin/deliveries/:id/archive` | Archives or restores a finished pickup using `{expectedVersion,archived}`. |

The customer generates a fresh UUID v4 for each submission and retains it during a retry. A matching retry after a lost response returns the original receipt. A changed identity, basket, quote or recipient combined with a reused identifier returns HTTP 409. Keep request IDs and tracking codes private. The server persists their hashes and immutable order snapshots. Guest tracking and signed-in receipts omit customer names, phones, addresses, delivery instructions and kitchen notes.

Customers can edit dish choices, quantity and special instructions in their bag before reviewing pickup. The optional dish preference checkbox remembers selected menu options on that device. Signed-in customers can add available selections from their earlier delivery history to the bag and review them for direct pickup.

At `/kitchen/`, start preparation and mark direct pickups ready. At `/staff/`, record the customer handoff as picked up. Staff can cancel a pickup before handoff and preview or save a pickup kitchen slip. Earlier deliveries retain their driver handoff and driver slip. Each status change locks the order, checks its version and records the manager and new status in the same transaction. Completed and cancelled tickets appear in order history.

Use **New pickup** in the Order Desk to enter a phone or walk-in order and review its server quote. Managers can also correct the last status, record a private manager note, or archive completed and cancelled pickups. Restore an archived order from the Archived view. The guest keeps access to the original receipt and tracking code. Dishes, prices and payment details on an accepted receipt are immutable.

For printer connection and supervised paper testing, see the [printer setup guide](../apps/print-bridge/README.md). Staff can download the pickup kitchen slip for manual use during rehearsal.

Open `/staff/reports/` to review volumes, busiest hours, frequently ordered dishes, discount use and averages for kitchen and delivery time. Reports group requests by the day they were received in Toronto. Food values, dishes, discounts and timing averages use delivered requests. Food values are estimates from the unpaid preview.

Run the PostgreSQL-backed ordering checks from the repo root.

```powershell
. .\ops\start-local-accounts.ps1 -DatabaseOnly
pnpm --filter @wok/api test
```

The tests use the dedicated test database and remove their own synthetic deliveries and accounts. They cover conflicting concurrent updates, duplicate submissions, repricing, guest privacy, manager authorization and immutable receipts.
