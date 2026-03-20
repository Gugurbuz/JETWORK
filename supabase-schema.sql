-- Supabase Schema for JetWork AI

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE users (
  uid UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT,
  email TEXT,
  photo_url TEXT,
  role TEXT,
  onboarding_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects Table
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  owner_id UUID REFERENCES users(uid),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Workspaces Table
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  item_number TEXT,
  title TEXT,
  owner_id UUID REFERENCES users(uid),
  collaborators JSONB DEFAULT '[]'::jsonb,
  document JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Messages Table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_name TEXT,
  sender_role TEXT,
  text TEXT,
  is_ai BOOLEAN DEFAULT false,
  attachments JSONB DEFAULT '[]'::jsonb,
  reactions JSONB DEFAULT '[]'::jsonb,
  grounding_urls JSONB DEFAULT '[]'::jsonb,
  questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared Analyses Table
CREATE TABLE shared_analyses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  document JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE workspaces;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_analyses;

-- Set up Row Level Security (RLS)
-- For development/testing, you can enable these policies to allow all access, 
-- but in production you should restrict them based on auth.uid()

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_analyses ENABLE ROW LEVEL SECURITY;

-- Allow all access for authenticated users (Development only)
CREATE POLICY "Allow all access for authenticated users" ON users FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all access for authenticated users" ON projects FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all access for authenticated users" ON workspaces FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all access for authenticated users" ON messages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all access for authenticated users" ON shared_analyses FOR ALL USING (auth.role() = 'authenticated');
