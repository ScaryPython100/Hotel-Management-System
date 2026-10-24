-- ============================================================================
--  Lock the database to signed-in staff
--
--  Run in Supabase -> SQL Editor ONLY AFTER:
--    1. the new code (staff sign-in + /api/guest) is live on Vercel, and
--    2. at least one staff account exists (Authentication -> Users -> Add user),
--    3. "Allow new users to sign up" is OFF (Authentication -> Sign In / Providers).
--
--  Afterwards the public anon key can no longer read or change anything.
--  Guests go through the /api functions, which use the service role key.
-- ============================================================================

ALTER TABLE public.guest_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrowed_items ENABLE ROW LEVEL SECURITY;

-- Remove every existing policy on the two tables (the old ones allowed everyone)
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('guest_requests', 'borrowed_items')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Signed-in staff can do everything; anonymous visitors get nothing
CREATE POLICY "staff_full_access" ON public.guest_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "staff_full_access" ON public.borrowed_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- To undo in an emergency (re-opens the database to everyone):
--   CREATE POLICY "temporary_public_access" ON public.guest_requests FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "temporary_public_access" ON public.borrowed_items FOR ALL USING (true) WITH CHECK (true);
