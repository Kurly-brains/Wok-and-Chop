# Local infrastructure and launch operations

For the connected local customer-account preview, use `ops/start-local-accounts.ps1`; see `docs/LOCAL-ACCOUNTS.md`. That script uses a task-owned PostgreSQL cluster on port 55440 and a generated, ignored local password. It does not use the optional Compose environment below.

Compose is development-only and binds PostgreSQL/Redis to loopback. Copy `ops/.env.example` to ignored `ops/.env`, set a local password, and run `docker compose --env-file ops/.env -f ops/compose.yaml up -d`. This starts infrastructure only; the API does not yet connect to it. No credentials or customer records are included in source control.

Apply and reverse the SQL migration in a disposable database before wiring application persistence. PostgreSQL 17.12 and Redis 7.4.12 image tags were verified against Docker's official-library registry on 18 November 2026. PostgreSQL 17 remains supported under its [versioning policy](https://www.postgresql.org/support/versioning/). Recheck security status before deployment. This repository does not claim a Docker, database restore, integration load, payment or hardware acceptance test has passed merely because these files exist.

## Restore procedure to implement and rehearse

1. Freeze new checkout and all printer dispatch; preserve surviving bridge journals.
2. Restore the verified PostgreSQL backup and environment configuration.
3. Reconcile Stripe captures/refunds across the recovery window with overlap; retain unresolved uncertainty.
4. Compare cloud jobs, local journals and staff evidence. Quarantine possible output as UNKNOWN.
5. Rebuild only proven-missing logical work; restore future capacity and pickup commitments.
6. Run a qualified test ticket, verify monitoring and resume with manager awareness.

Do not blindly replay a restored outbox into printers. Record measured RPO/RTO and an incident owner. The brief's recovery values are targets until a restore drill provides evidence.

## Opening and closing checklist

Before accepting money: approved hours/menu/capacity, authenticated KDS, recent bridge heartbeat, paper, qualified test ticket and staffed escalation. At closing: resolve paid exceptions, pending refunds, UNKNOWN jobs and future scheduled orders; reconcile existing Checkout sessions before releasing holds. A website pause alone cannot invalidate an already-open provider session.
