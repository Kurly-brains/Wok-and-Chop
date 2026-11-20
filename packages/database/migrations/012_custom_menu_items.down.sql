BEGIN;
SELECT pg_advisory_xact_lock(18315, 12);
DELETE FROM shared_preview_menu_items WHERE item_id IN (SELECT item_id FROM shared_preview_custom_menu_items);
DROP TABLE IF EXISTS shared_preview_custom_menu_items;
DROP FUNCTION IF EXISTS protect_custom_menu_definition();
UPDATE shared_preview_menu SET version=version+1 WHERE singleton;
COMMIT;
