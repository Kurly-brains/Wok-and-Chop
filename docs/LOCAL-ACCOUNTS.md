# Local customer accounts

The customer account extension was requested after the initial guest-first brief. Guest browsing and cart building remain available without an account. Real local customer registration/sign-in is separate from payment and kitchen functionality: an account does not create an order, verify a payment, grant staff access or enable checkout.

## Start and test

From the project root in PowerShell:

```powershell
& .\ops\start-local-accounts.ps1
```

The script initializes only its own database cluster under `ops/.local/postgres`, binds it to `127.0.0.1:55440`, creates `wok_chop_auth_dev` and the separate `wok_chop_auth_test`, applies the customer-account migration, builds the API and serves it at `http://127.0.0.1:4000`. It uses installed PostgreSQL 18 tools from `C:\Program Files\PostgreSQL\18\bin`; adjust that explicit path if your installation differs. It does not connect to or change an existing system PostgreSQL service. The previous disposable schema-test cluster is unrelated and remains stopped.

Database password generation uses secure random bytes, SCRAM host authentication and ignored local state. `ops/.local/.gitignore` excludes the cluster, generated password and logs from source control. No database credential is printed. Do not remove the password file from an existing local cluster; the script refuses to silently replace it.

For integration tests, load the local environment in the same shell:

```powershell
. .\ops\start-local-accounts.ps1 -DatabaseOnly
pnpm --filter @wok/api test
```

Database-backed tests require the dedicated local test database. They clean up their own synthetic accounts or roll back fixture transactions. Set `AUTH_TEST_DATABASE_URL` through the startup script to include these checks.

On 18 November 2026, API build and typecheck passed, and all ten tests passed against the isolated PostgreSQL 18.3 cluster with no skips. The account tests cover validation, case-normalized email uniqueness, scrypt password storage, hashed session storage, API restart persistence, invalid credentials, session fixation/rotation/revocation/expiry, forbidden/missing origins, credentialed CORS, strict JSON, and rate limiting that ignores forged forwarding headers. Configuration tests cover production refusal, remote-host rejection and database URL override rejection; HTTP checks cover DNS-rebinding Host values and response security headers. Payment creation remains HTTP 503 after sign-in.

Stop the API with Ctrl+C. The task-owned PostgreSQL instance persists for later previews. To stop only that instance:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '.\ops\.local\postgres' -m fast -w stop
```

No account or database deletion is part of these commands.

## Browser contract

Open the storefront at exactly `http://127.0.0.1:3000`. Browser requests to the API use `credentials: 'include'`. The configured origin is exact, so `localhost:3000` is a different origin. Account mutation requests require `Content-Type: application/json` and the approved browser Origin. No credential value belongs in client storage or response JSON.

| Endpoint                 | Input                      | Result                                 |
| ------------------------ | -------------------------- | -------------------------------------- |
| `POST /v1/auth/register` | `{name,email,password}`    | 201 `{user:{id,name,email}}`; signs in |
| `POST /v1/auth/login`    | `{email,password}`         | 200 `{user:{id,name,email}}`           |
| `GET /v1/auth/me`        | Session cookie, if present | 200 `{user:...}` or `{user:null}`      |
| `GET /v1/auth/orders` | Session cookie, optional `after` cursor | `{accountId, orders, nextCursor}` |
| `POST /v1/auth/logout`   | `{}` and session cookie    | 200 `{ok:true}`; revokes session       |

Names allow 1–80 characters. Email addresses are trimmed and normalized to lowercase. Passwords allow 12–128 characters on registration; no arbitrary composition rules are imposed. Unknown fields are rejected. Duplicate registration returns 409, invalid credentials 401, invalid input 400, forbidden Origin 403 and excess account attempts 429. Responses containing account information use `Cache-Control: no-store`.

## Customer pickup history

The account page reads up to ten pickup orders at a time, newest first. Expand a receipt for its dishes, modifiers, payment status and pickup time in Kanata. Prices come from the active immutable order revision. Guest checkout and staff training tickets stay separate from a customer's receipts.

The local setup applies the order ledger in migration 001 and the customer ownership link in migration 003. A future order writer must assign `orders.customer_account_id` from the authenticated session when creating the order. Existing orders without explicit ownership remain unlinked. The history endpoint returns 401 for an absent or expired session and uses the session's account ID for both the result set and the pagination cursor. The history integration test rolls back its fixture orders.

## Security and production boundary

Passwords use asynchronous Node scrypt with a random 16-byte salt, N=32768/r=8/p=1 and a 64-byte derived key. Comparisons use timing-safe equality; unknown accounts still execute a password derivation. Session cookies contain a random 32-byte token; PostgreSQL stores only its SHA-256 digest. Sessions last seven days, rotate on sign-in and are revoked server-side on logout. Expired/revoked sessions are rejected. Cookies are HttpOnly, SameSite=Lax and scoped to `/v1/auth`.

The local HTTP cookie deliberately has no Secure flag because this process serves only loopback development. Both the entrypoint and application factory refuse `NODE_ENV=production`; database URLs are restricted to the dedicated local account databases and reject query-string host overrides. Requests with non-loopback Host headers are rejected. Responses disable caching and MIME sniffing and deny framing. A deployment requires HTTPS/Secure cookies, production host validation, shared persistent rate limiting, least-privilege runtime database roles, session cleanup/retention jobs, operational monitoring, independent security review and approved privacy/account policies. The current 20-attempt/15-minute limiter is scoped to the API process and remote socket address; it resets on restart and does not trust forwarding headers.

The local customer directory at `/staff/customers/` requires a signed-in account with a row in `restaurant_managers`. With the local API running, run `ops/setup-local-manager.ps1` to provision a dedicated workstation manager. Its generated sign-in details are saved under `%LOCALAPPDATA%\WokAndChop\local-manager.json` outside the project. The directory supports name and email searches and shows orders linked to the selected account. Removing the database grant immediately revokes access on subsequent requests.

Email verification, password recovery, social login and MFA remain future work. Staff training tickets remain isolated from customer accounts and pickup receipts.

Selected dependencies `pg` and `@types/pg` are pinned to 8.23.1, verified against the registry on 18 November 2026. Database queries follow [node-postgres parameterized-query guidance](https://node-postgres.com/features/queries); transactions stay on one checked-out client as required by the [pool documentation](https://node-postgres.com/apis/pool). Passwords and tokens use the Node crypto primitives documented in [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html).
