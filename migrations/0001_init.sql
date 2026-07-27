CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  message_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'telegram',
  category_id INTEGER,
  chat_id TEXT NOT NULL,
  is_chunked INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  upload_id TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX IF NOT EXISTS files_created_cursor ON files(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS file_path_cache (
  file_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS file_path_cache_expiry ON file_path_cache(expires_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL
);
