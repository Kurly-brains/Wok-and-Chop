BEGIN;
SELECT pg_advisory_xact_lock(18315, 12);
CREATE TABLE IF NOT EXISTS shared_preview_custom_menu_items (
  item_id text PRIMARY KEY CHECK (item_id ~ '^lunch-custom-[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  create_request_hash text NOT NULL UNIQUE CHECK (create_request_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (definition ?& ARRAY['name','categoryId','priceCents']),
  CHECK (jsonb_typeof(definition->'name') = 'string' AND length(definition->>'name') BETWEEN 1 AND 80),
  CHECK (definition->>'categoryId' IN ('lunch-chicken','lunch-beef','lunch-fish','lunch-vegetarian','lunch-rice-noodles')),
  CHECK (jsonb_typeof(definition->'priceCents') = 'number' AND (definition->>'priceCents')::numeric BETWEEN 1 AND 200000
    AND (definition->>'priceCents')::numeric = trunc((definition->>'priceCents')::numeric))
);
CREATE OR REPLACE FUNCTION protect_custom_menu_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.item_id,OLD.definition,OLD.create_request_hash,OLD.request_fingerprint,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.item_id,NEW.definition,NEW.create_request_hash,NEW.request_fingerprint,NEW.created_at) THEN
    RAISE EXCEPTION 'Created menu item identity and initial definition are immutable; use menu overrides for edits';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS custom_menu_definition_guard ON shared_preview_custom_menu_items;
CREATE TRIGGER custom_menu_definition_guard BEFORE UPDATE ON shared_preview_custom_menu_items
  FOR EACH ROW EXECUTE FUNCTION protect_custom_menu_definition();
COMMIT;
