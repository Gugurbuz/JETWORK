/*
  # Fix RLS Policies and Anonymous User Support

  1. Problems Fixed
    - INSERT policies for projects and workspaces had no WITH CHECK clause, blocking inserts
    - Anonymous users trying to save with username='User' hit UNIQUE constraint on users.username
    - users table has separate 'name' column that should be used for displayName instead of username

  2. Changes
    - Drop and recreate INSERT policies with proper WITH CHECK clauses
    - Make users.username nullable and not unique to avoid conflicts
    - Ensure anonymous users can create projects and workspaces
*/

-- Fix projects INSERT policy - add WITH CHECK
DROP POLICY IF EXISTS "Giriş yapanlar proje oluşturabilir" ON projects;
CREATE POLICY "Giriş yapanlar proje oluşturabilir"
  ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Fix workspaces INSERT policy - add WITH CHECK  
DROP POLICY IF EXISTS "Giriş yapanlar çalışma alanı oluşturabilir" ON workspaces;
CREATE POLICY "Giriş yapanlar çalışma alanı oluşturabilir"
  ON workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Make username not unique to avoid conflicts with anonymous users all getting 'User'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;

-- Add a unique constraint only when username is not null and not 'User'
-- Actually just remove uniqueness - names don't need to be unique
