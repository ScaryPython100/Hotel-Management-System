-- ============================================================================
--  One-time cleanup of data the app no longer uses
--  Run in Supabase -> SQL Editor after the new code is live. Safe to run twice.
-- ============================================================================

BEGIN;

-- 1. Requests hidden through the old shared "dismissed" list get the per-request flag
--    the dashboard now uses, so they stay hidden.
UPDATE public.guest_requests
SET is_deleted_from_dashboard = true,
    deleted_at = COALESCE(deleted_at, (extract(epoch from now()) * 1000)::bigint)
WHERE id IN (
  SELECT jsonb_array_elements_text(custom_message::jsonb)
  FROM public.guest_requests
  WHERE id = 'system-dismissed-requests-global'
);

-- 2. Rows nothing reads any more
DELETE FROM public.guest_requests
WHERE id IN ('system-auto-depleted-items', 'system-dismissed-requests-global');

-- 3. Old item names in the availability and stock settings
UPDATE public.guest_requests
SET custom_message = (custom_message::jsonb - ARRAY[
      'Leg Massager (Paid)', 'Glasses (Set of 2)', 'USB 3.0 Cable + Adaptor', 'Infrared Heat Therapy Lamp (Paid)',
      'Maggi (₹20)', 'Eggs (₹10)', 'Coffee Sachet (₹5 per sachet)', 'Soft Drinks (₹50)',
      'Toned Milk 200/500 mL (₹30)', 'Masala Box (₹50)', 'Wifi Password (HuesStay123@)',
      'Supervisor Contact Number (8431995152)', 'Soap Refill', 'Stay Extension',
      'Housekeeping Service (Only Between 9 A.M. and 5 P.M.)', 'Water Bottle (Paid)',
      'Teakettle', 'Glasses', 'Water Glasses', 'Wifi Password Request', 'Hand wash Refill'
    ])::text,
    updated_at = now()
WHERE id IN ('system-amenities-settings-global', 'system-inventory-limits-global');

-- 4. The same old names in the list of items staff removed from the guest page
UPDATE public.guest_requests
SET custom_message = (
      SELECT COALESCE(jsonb_agg(name), '[]'::jsonb)::text
      FROM jsonb_array_elements_text(custom_message::jsonb) AS name
      WHERE name NOT IN (
        'Leg Massager (Paid)', 'Glasses (Set of 2)', 'USB 3.0 Cable + Adaptor', 'Infrared Heat Therapy Lamp (Paid)',
        'Maggi (₹20)', 'Eggs (₹10)', 'Coffee Sachet (₹5 per sachet)', 'Soft Drinks (₹50)',
        'Toned Milk 200/500 mL (₹30)', 'Masala Box (₹50)'
      )
    ),
    updated_at = now()
WHERE id = 'system-deleted-items';

COMMIT;
