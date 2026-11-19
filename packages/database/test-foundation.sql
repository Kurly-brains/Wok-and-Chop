-- Disposable database only. Exercises actual PostgreSQL constraints; leaves no fixture records.
BEGIN;
DO $$
DECLARE
  loc uuid := gen_random_uuid();
  ord uuid := gen_random_uuid();
  attempt uuid := gen_random_uuid();
  second_attempt uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  job uuid := gen_random_uuid();
BEGIN
  INSERT INTO locations(id, name, address) VALUES (loc, 'Schema test fixture', 'Not a restaurant record');
  INSERT INTO orders(id, location_id, business_date, display_number) VALUES (ord, loc, '2026-11-18', 1);
  INSERT INTO order_revisions(order_id, revision, total_cents, lines, tax_snapshot, pricing_snapshot, menu_version)
    VALUES (ord, 1, 1200, '[]', '{}', '{}', 'schema-fixture');
  INSERT INTO payment_attempts(id, order_id, revision, expected_amount_cents, provider_idempotency_key, request_fingerprint, expires_at)
    VALUES (attempt, ord, 1, 1200, 'schema-attempt-1', repeat('a',64), now() + interval '30 minutes');

  BEGIN
    INSERT INTO payment_attempts(order_id, revision, expected_amount_cents, provider_idempotency_key, request_fingerprint, expires_at)
      VALUES (ord, 1, 1200, 'schema-attempt-2', repeat('a',64), now() + interval '30 minutes');
    RAISE EXCEPTION 'Expected active attempt uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE payment_attempts SET status = 'SUCCEEDED' WHERE id = attempt;
  INSERT INTO payment_attempts(id, order_id, revision, status, expected_amount_cents, provider_idempotency_key, request_fingerprint, expires_at)
    VALUES (second_attempt, ord, 1, 'SUCCEEDED', 1200, 'schema-extra-attempt', repeat('a',64), now());
  INSERT INTO captures(id, order_id, attempt_id, provider_payment_id, provider_account_id, environment, amount_cents, is_canonical, verified_at)
    VALUES (capture, ord, attempt, 'schema-pi-1', 'schema-account', 'test', 1200, true, now());
  UPDATE orders SET canonical_payment_id = capture WHERE id = ord;
  BEGIN
    INSERT INTO captures(order_id, attempt_id, provider_payment_id, provider_account_id, environment, amount_cents, is_canonical, verified_at)
      VALUES (ord, second_attempt, 'schema-pi-2', 'schema-account', 'test', 1200, true, now());
    RAISE EXCEPTION 'Expected canonical capture uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Additional real successes remain recordable for reconciliation, without becoming canonical.
  INSERT INTO captures(order_id, attempt_id, provider_payment_id, provider_account_id, environment, amount_cents, verified_at)
    VALUES (ord, second_attempt, 'schema-pi-2', 'schema-account', 'test', 1200, now());

  INSERT INTO print_jobs(id, order_id, revision, station_id, ticket_type, payload, payload_hash, template_version, due_at)
    VALUES (job, ord, 1, 'kitchen', 'PRODUCTION', '{}', repeat('b',64), 'test-v1', now());
  BEGIN
    INSERT INTO print_jobs(order_id, revision, station_id, ticket_type, payload, payload_hash, template_version, due_at)
      VALUES (ord, 1, 'kitchen', 'PRODUCTION', '{}', repeat('b',64), 'test-v1', now());
    RAISE EXCEPTION 'Expected original KOT uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO print_jobs(order_id, revision, station_id, ticket_type, original_job_id, copy_number, authorized_by, payload, payload_hash, template_version, due_at)
      VALUES (ord, 1, 'kitchen', 'REPRINT', job, 1, 'manager-fixture', '{}', repeat('b',64), 'test-v1', now());
    RAISE EXCEPTION 'Expected missing reprint reason rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO print_jobs(order_id, revision, station_id, ticket_type, original_job_id, copy_number, authorized_by, reason, payload, payload_hash, template_version, due_at)
    VALUES (ord, 1, 'kitchen', 'REPRINT', job, 1, 'manager-fixture', 'Observed missing ticket', '{}', repeat('c',64), 'test-v1', now());

  BEGIN
    UPDATE order_revisions SET total_cents = 1 WHERE order_id = ord;
    RAISE EXCEPTION 'Expected immutable revision rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Immutable record cannot be changed' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE print_jobs SET payload_hash = repeat('d',64) WHERE id = job;
    RAISE EXCEPTION 'Expected immutable print identity rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Print identity and payload are immutable; create a new authorized job' THEN RAISE; END IF;
  END;
  UPDATE print_jobs SET status = 'UNKNOWN' WHERE id = job;

  INSERT INTO webhook_inbox(provider_event_id, event_type, environment, signature_verified_at, restricted_payload)
    VALUES ('schema-event', 'fixture', 'test', now(), '{}');
  BEGIN
    INSERT INTO webhook_inbox(provider_event_id, event_type, environment, signature_verified_at, restricted_payload)
      VALUES ('schema-event', 'fixture', 'test', now(), '{}');
    RAISE EXCEPTION 'Expected provider event uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO outbox_events(business_key, order_id, event_type, schema_version, payload)
    VALUES ('schema-receipt', ord, 'fixture', 1, '{}');
  BEGIN
    INSERT INTO outbox_events(business_key, order_id, event_type, schema_version, payload)
      VALUES ('schema-receipt', ord, 'fixture', 1, '{}');
    RAISE EXCEPTION 'Expected outbox business key uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'Foundation constraints passed; this is not concurrency or provider integration acceptance.';
END;
$$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
