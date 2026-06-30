-- Email-only demo sign-ins: who opened the live console.
CREATE TABLE IF NOT EXISTS demo_signin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS demo_signin_email_idx ON demo_signin(email);
CREATE INDEX IF NOT EXISTS demo_signin_created_at_idx ON demo_signin(created_at);
