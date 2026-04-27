DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products_staging'
      AND data_type IN ('numeric', 'integer')
  ) LOOP
    EXECUTE format(
      'ALTER TABLE public.products_staging ALTER COLUMN %I TYPE TEXT USING %I::text;',
      r.column_name,
      r.column_name
    );
  END LOOP;
END $$;
