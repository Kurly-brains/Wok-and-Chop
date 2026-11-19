BEGIN;
SELECT pg_advisory_xact_lock(18315, 7);
CREATE TABLE IF NOT EXISTS shared_preview_menu (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO shared_preview_menu(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS shared_preview_menu_items (
  item_id text PRIMARY KEY,
  patch jsonb NOT NULL CHECK (jsonb_typeof(patch) = 'object'),
  updated_by uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
