# Local home delivery

The delivery workflow runs on the loopback restaurant API and persists unpaid test requests in PostgreSQL. Use test contact and address details. Starting the account service applies migration 005 to its dedicated local development and test databases.

```powershell
& .\ops\start-local-accounts.ps1
```

By default the local rehearsal accepts Ontario postal codes. To rehearse a smaller area, set `DELIVERY_POSTAL_PREFIXES` to comma-separated Ontario forward sortation areas in the API environment. This setting describes the local test area. A launch requires the restaurant's actual service area, hours, capacity, fee/tax policy, dispatch arrangements, customer communications and data retention policy.

The server prices dishes and modifiers from its catalog. WOK10 and DEMO5 follow the existing preview promotion rules. A customer reviews a food total in CAD, including the applicable demo discount. Delivery fees and taxes are unconfigured (`null`). The preview creates an unpaid delivery record without a charge or a promised arrival time.

## Requests and tracking

All endpoints use the prefix `/v1/auth`. For POST requests, send JSON from the configured storefront origin. Signed-in buyers and managers also send the existing HttpOnly account cookie.

| Request | Behaviour |
| --- | --- |
| GET `deliveries/config` | Reads local delivery mode and configured postal prefixes. |
| POST `deliveries/quote` | Validates the postal code, quantities, modifiers and promo code, then returns line prices, total and a quote fingerprint. |
| POST `deliveries` | Stores the reviewed quote with its contact and address and returns a numbered receipt and private tracking code. |
| POST `deliveries/track` | Accepts the private tracking code in the body. An optional number must also match. Returns food details and current status. |
| GET `deliveries/mine` | Returns one page of deliveries for the signed-in customer. |
| GET `admin/deliveries` | Lists manager-visible deliveries with contact, address and kitchen notes. Use `scope=active` or `scope=history` and the returned `nextCursor` as `after`. |
| GET `admin/customers/:id/deliveries` | Lists delivery receipts linked to the selected customer in the manager directory. |
| POST `admin/deliveries/:id/status` | Requires manager access and a valid `{expectedVersion,status}` command. A stale or invalid transition returns HTTP 409. |

The customer generates a fresh UUID v4 for each submission and retains it during a retry. A matching retry after a lost response returns the original receipt. A changed identity, basket, quote or recipient combined with a reused identifier returns HTTP 409. Keep request IDs and tracking codes private. The server persists their hashes and immutable order snapshots. Guest tracking and signed-in receipts omit customer names, phones, addresses, delivery instructions and kitchen notes.

Managers move received deliveries through preparation, out for delivery and delivered. Cancellation is available while received or preparing. Each status change locks the order, checks its version and records the manager and new status in the same transaction. Both terminal states appear in history.

Run the PostgreSQL-backed delivery checks from the repo root.

```powershell
. .\ops\start-local-accounts.ps1 -DatabaseOnly
pnpm --filter @wok/api test
```

The tests use the dedicated test database and remove their own synthetic deliveries and accounts. They cover conflicting concurrent updates, duplicate submissions, repricing, guest privacy, manager authorization and immutable receipts.
