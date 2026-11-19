# API foundation

This NestJS service intentionally rejects live quotes, Checkout creation and webhooks with HTTP 503. It contains no payment simulator or in-memory order ledger. Liveness is separate from readiness. It binds to loopback and refuses production startup. The requested customer-account extension adds real local PostgreSQL registration, sign-in, session lookup and logout, independently of ordering; see `docs/LOCAL-ACCOUNTS.md` for setup and security boundaries.

Run the unconfigured foundation from the repository root using `pnpm --filter @wok/api dev`, or run `ops/start-local-accounts.ps1` for the connected local account service. `GET /v1/health` is 200; `GET /v1/readiness` is 503; `GET /v1/availability` describes the unavailable pickup-only service. Ordering mutation endpoints do not create records; account endpoints write to their separate local database. Synthetic storefront content belongs to the explicitly labeled preview, not a live menu endpoint.

NestJS 11.2.11 is pinned following the [NestJS v11 first steps](https://docs.nestjs.com/v11/first-steps) and registry verification on 18 November 2026. Node 24.14.0 was present during implementation. There is no selected Stripe SDK/API version yet because no Stripe integration is implemented. Read `docs/IMPLEMENTATION.md` before extending this boundary.
