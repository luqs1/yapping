// The server's one SQLite file, $YAP_DATA/server.db.
//
// What lives here is identity and plumbing, never message content:
//   users, sessions, magic links, passkeys        who you are
//   devices, device_codes                         your Macs and their public keys
//   contacts, invites                             who you talk to, and your private notes on them
//   mailbox                                       sealed envelopes waiting for an offline device
//   oauth_*                                       chat hosts (Claude, ChatGPT, Codex) acting as you
//
// Every secret (session id, device token, OAuth code and tokens) is stored
// as its SHA-256 only.

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  google_sub TEXT UNIQUE,
  domain TEXT,                       -- Google Workspace domain (the id token's hd), if any
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_domain ON users(domain);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  next TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Short-lived state for a sign-in round trip (Google OIDC, WebAuthn).
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,               -- credential id, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  box_pub TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  box_pub TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  status TEXT NOT NULL,              -- pending | approved | denied | done
  user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One row per direction: (owner, contact) is the owner's private view.
CREATE TABLE IF NOT EXISTS contacts (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, contact_id)
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox (
  id TEXT PRIMARY KEY,
  to_device TEXT NOT NULL,
  from_device TEXT NOT NULL,
  env TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mailbox_to ON mailbox(to_device, created_at);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- dcr | cimd
  name TEXT,
  redirect_uris TEXT NOT NULL,       -- JSON array
  auth_method TEXT NOT NULL,         -- none | client_secret_post | client_secret_basic
  secret_hash TEXT,
  metadata TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fetched_at INTEGER                 -- CIMD: when the metadata document was last fetched
);

CREATE TABLE IF NOT EXISTS oauth_requests (
  id TEXT PRIMARY KEY,               -- one pending consent screen
  user_id TEXT NOT NULL,
  params TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- access | refresh
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  family TEXT NOT NULL,              -- every token from one authorization; revoked together on refresh reuse
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens(family);
`

export type DB = Database

export function openDb(dataDir: string): DB {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, 'server.db'), { create: true, strict: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  return db
}

// Drop whatever has expired. Run at start and then hourly.
export function sweep(db: DB, t = Date.now()) {
  for (const table of ['sessions', 'magic_links', 'flows', 'device_codes', 'invites', 'mailbox', 'oauth_requests', 'oauth_codes', 'oauth_tokens'])
    db.query(`DELETE FROM ${table} WHERE expires_at < ?`).run(t)
}
