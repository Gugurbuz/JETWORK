/*
  # Create settings table

  1. New Tables
    - `settings`
      - `id` (text, primary key) — stable key like 'prompts'
      - `data` (jsonb) — arbitrary settings payload
      - `updated_at` (timestamptz)
  2. Security
    - Enable RLS
    - Authenticated users can read and write; shared configuration
*/

CREATE TABLE IF NOT EXISTS settings (
  id text PRIMARY KEY,
  data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Authenticated can read settings') THEN
    CREATE POLICY "Authenticated can read settings"
      ON settings FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Authenticated can insert settings') THEN
    CREATE POLICY "Authenticated can insert settings"
      ON settings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='Authenticated can update settings') THEN
    CREATE POLICY "Authenticated can update settings"
      ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
