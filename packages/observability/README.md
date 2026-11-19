# Observability boundary

The foundation API returns a random correlation ID with unavailable-operation responses and does not log request bodies. Production structured logs, metrics, traces, alert routing and audit access controls are not connected.

Use an allowlist for log fields: correlation ID, internal order/attempt/event/job IDs, state transitions, duration, retry count and a stable error category. Exclude names, email, telephone, allergy text, tokens, cookies, authorization headers, Stripe secrets and raw webhook payloads. An error message from a provider is not automatically safe to log.

Required signals before launch: oldest inbox/outbox age, canonical capture without accepted/exception state, accepted due order without KOT obligation, overdue/UNKNOWN jobs, device heartbeat age, pending refund age, notification errors and provider reconciliation mismatches. Each alert needs a named responder and escalation path. Metrics must distinguish transport delivery from device confirmation and kitchen acknowledgment.
