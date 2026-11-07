-- Satori V2 — PostgreSQL Schema (Phase 6 / G9)
-- Relational DDL with JSONB documents for full compatibility and ACID persistence.

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id BIGINT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  short_name VARCHAR(20),
  country VARCHAR(64),
  website VARCHAR(300),
  description TEXT,
  domain_regex VARCHAR(255),
  admins JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_organizations_data ON organizations USING GIN (data);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  login VARCHAR(64) UNIQUE NOT NULL,
  first_name VARCHAR(64),
  last_name VARCHAR(64),
  email VARCHAR(255) UNIQUE NOT NULL,
  pass VARCHAR(255) NOT NULL,
  affiliation_org_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  roles_global JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(affiliation_org_id);
CREATE INDEX IF NOT EXISTS idx_users_data ON users USING GIN (data);

-- 3. Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT PRIMARY KEY,
  jti VARCHAR(128) UNIQUE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  device VARCHAR(255),
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti);
CREATE INDEX IF NOT EXISTS idx_sessions_data ON sessions USING GIN (data);

-- 4. Contests
CREATE TABLE IF NOT EXISTS contests (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  mode VARCHAR(32) NOT NULL DEFAULT 'ICPC',
  lifecycle VARCHAR(32) NOT NULL DEFAULT 'draft',
  registration VARCHAR(32) NOT NULL DEFAULT 'invite',
  visibility VARCHAR(32) NOT NULL DEFAULT 'members',
  archived BOOLEAN DEFAULT FALSE,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  freeze_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}'::jsonb,
  members JSONB DEFAULT '[]'::jsonb,
  pending JSONB DEFAULT '[]'::jsonb,
  admins JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_contests_lifecycle ON contests(lifecycle);
CREATE INDEX IF NOT EXISTS idx_contests_visibility ON contests(visibility);
CREATE INDEX IF NOT EXISTS idx_contests_data ON contests USING GIN (data);

-- 5. Teams
CREATE TABLE IF NOT EXISTS teams (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  member_ids JSONB DEFAULT '[]'::jsonb,
  login_identity VARCHAR(64),
  scoreboard_name VARCHAR(120),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_teams_contest_id ON teams(contest_id);
CREATE INDEX IF NOT EXISTS idx_teams_data ON teams USING GIN (data);

-- 6. Problem Sets
CREATE TABLE IF NOT EXISTS problem_sets (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_problem_sets_contest_id ON problem_sets(contest_id);
CREATE INDEX IF NOT EXISTS idx_problem_sets_data ON problem_sets USING GIN (data);

-- 7. Problems
CREATE TABLE IF NOT EXISTS problems (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  set_id BIGINT REFERENCES problem_sets(id) ON DELETE SET NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  statement_md TEXT,
  statement_html TEXT,
  samples JSONB DEFAULT '[]'::jsonb,
  limits JSONB DEFAULT '{}'::jsonb,
  visibility VARCHAR(32) DEFAULT 'visible',
  deadline_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_problems_contest_id ON problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_problems_code ON problems(code);
CREATE INDEX IF NOT EXISTS idx_problems_data ON problems USING GIN (data);

-- 8. Test Groups
CREATE TABLE IF NOT EXISTS test_groups (
  id BIGINT PRIMARY KEY,
  problem_id BIGINT REFERENCES problems(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL DEFAULT 'all',
  points NUMERIC(6,2) DEFAULT 100,
  subtask INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_test_groups_problem_id ON test_groups(problem_id);
CREATE INDEX IF NOT EXISTS idx_test_groups_data ON test_groups USING GIN (data);

-- 9. Test Cases
CREATE TABLE IF NOT EXISTS test_cases (
  id BIGINT PRIMARY KEY,
  group_id BIGINT REFERENCES test_groups(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected TEXT NOT NULL,
  checker VARCHAR(32) DEFAULT 'token',
  time_ms INTEGER DEFAULT 1000,
  memory_mb INTEGER DEFAULT 256,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_test_cases_group_id ON test_cases(group_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_data ON test_cases USING GIN (data);

-- 10. Submits
CREATE TABLE IF NOT EXISTS submits (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE SET NULL,
  problem_id BIGINT REFERENCES problems(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  lang VARCHAR(32) NOT NULL,
  code TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'QUE',
  points NUMERIC(6,2) DEFAULT 0,
  cpu_ms INTEGER DEFAULT 0,
  mem_mb INTEGER,
  per_test JSONB,
  per_test_full JSONB,
  compile_log TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  judged_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_submits_contest_id ON submits(contest_id);
CREATE INDEX IF NOT EXISTS idx_submits_problem_id ON submits(problem_id);
CREATE INDEX IF NOT EXISTS idx_submits_user_id ON submits(user_id);
CREATE INDEX IF NOT EXISTS idx_submits_status ON submits(status);
CREATE INDEX IF NOT EXISTS idx_submits_created_at ON submits(created_at);
CREATE INDEX IF NOT EXISTS idx_submits_data ON submits USING GIN (data);

-- 11. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT PRIMARY KEY,
  actor_id BIGINT,
  action VARCHAR(64) NOT NULL,
  target VARCHAR(128),
  at TIMESTAMPTZ DEFAULT NOW(),
  meta JSONB DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_log_data ON audit_log USING GIN (data);

-- 12. News (Announcements)
CREATE TABLE IF NOT EXISTS news (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body_md TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_news_contest_id ON news(contest_id);
CREATE INDEX IF NOT EXISTS idx_news_data ON news USING GIN (data);

-- 13. Clarifications
CREATE TABLE IF NOT EXISTS clarifications (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  problem_id BIGINT REFERENCES problems(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  status VARCHAR(16) DEFAULT 'pending',
  broadcast BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_clarifications_contest_id ON clarifications(contest_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_problem_id ON clarifications(problem_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_data ON clarifications USING GIN (data);

-- 14. Appeals
CREATE TABLE IF NOT EXISTS appeals (
  id BIGINT PRIMARY KEY,
  contest_id BIGINT REFERENCES contests(id) ON DELETE CASCADE,
  submit_id BIGINT REFERENCES submits(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status VARCHAR(16) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_appeals_contest_id ON appeals(contest_id);
CREATE INDEX IF NOT EXISTS idx_appeals_submit_id ON appeals(submit_id);
CREATE INDEX IF NOT EXISTS idx_appeals_data ON appeals USING GIN (data);

-- 15. Emails (Transactional Queue)
CREATE TABLE IF NOT EXISTS email_queue (
  id BIGINT PRIMARY KEY,
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_next_attempt ON email_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_data ON email_queue USING GIN (data);

-- 16. Generic Document Store (Supporting all arbitrary Satori collections)
CREATE TABLE IF NOT EXISTS satori_documents (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_satori_documents_collection ON satori_documents(collection);
CREATE INDEX IF NOT EXISTS idx_satori_documents_data ON satori_documents USING GIN (data);
