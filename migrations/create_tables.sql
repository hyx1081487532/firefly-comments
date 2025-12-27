-- D1 schema for Firefly Comments

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  name TEXT,
  email TEXT,
  content TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- If your database already existed without the `ip` or `user_agent` columns,
-- you can add them manually using the following SQL:
-- ALTER TABLE comments ADD COLUMN ip TEXT;
-- ALTER TABLE comments ADD COLUMN user_agent TEXT;
