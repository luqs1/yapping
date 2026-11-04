// The node's memory: one SQLite file (node.db).
//
// Rows hold the UI shapes from shared/sim.js as JSON, so a snapshot is just
// "read them back": users, chats (with `sees` and `unread` inside), messages
// and assists. `events` is the UI event log; its rowid is `seq`, which is
// what `sync {since}` pages through. `devices` caches who can receive our
// envelopes; `outbox` holds frames written while the socket was down.

import { Database } from 'bun:sqlite'
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ensureHome } from './paths'

export type Json = Record<string, any>

const SCHEMA = `
create table if not exists kv (key text primary key, value text);
create table if not exists users (id text primary key, json text not null);
create table if not exists chats (id text primary key, json text not null, last_ts integer not null default 0);
create table if not exists messages (id text primary key, chat_id text not null, ts integer not null, json text not null);
create index if not exists messages_chat on messages (chat_id, ts);
create table if not exists assists (id text primary key, chat_id text not null, msg_id text, json text not null);
create index if not exists assists_msg on assists (msg_id);
create table if not exists events (seq integer primary key autoincrement, json text not null);
create table if not exists devices (device_id text primary key, user_id text not null, box_pub text not null, sign_pub text not null, name text, fetched_at integer not null);
create index if not exists devices_user on devices (user_id);
create table if not exists outbox (id integer primary key autoincrement, frame text not null);
`

// How many UI events to keep for `sync`. Older clients just reload `state`.
const KEEP_EVENTS = 5000

export type Device = { deviceId: string; userId: string; boxPub: string; signPub: string; name?: string }

export function openStore(home: string) {
  ensureHome(home)
  const db = new Database(join(home, 'node.db'), { create: true })
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 3000;')
  db.exec(SCHEMA)
  // Messages are private: only the owner may read the database files.
  for (const f of ['node.db', 'node.db-wal', 'node.db-shm']) {
    const p = join(home, f)
    if (existsSync(p)) try { chmodSync(p, 0o600) } catch {}
  }

  const parse = (r: { json: string } | null | undefined) => (r ? JSON.parse(r.json) : undefined)
  const q = {
    kvGet: db.query<{ value: string }, [string]>('select value from kv where key = ?'),
    kvSet: db.query('insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value'),
    user: db.query<{ json: string }, [string]>('select json from users where id = ?'),
    users: db.query<{ json: string }, []>('select json from users'),
    putUser: db.query('insert into users (id, json) values (?, ?) on conflict(id) do update set json = excluded.json'),
    chat: db.query<{ json: string }, [string]>('select json from chats where id = ?'),
    chats: db.query<{ json: string }, []>('select json from chats order by last_ts desc'),
    putChat: db.query('insert into chats (id, json, last_ts) values (?, ?, ?) on conflict(id) do update set json = excluded.json, last_ts = max(chats.last_ts, excluded.last_ts)'),
    msg: db.query<{ json: string }, [string]>('select json from messages where id = ?'),
    putMsg: db.query('insert into messages (id, chat_id, ts, json) values (?, ?, ?, ?) on conflict(id) do update set json = excluded.json'),
    recent: db.query<{ json: string }, [string, number]>('select json from (select json, ts from messages where chat_id = ? order by ts desc limit ?) order by ts asc'),
    assist: db.query<{ json: string }, [string]>('select json from assists where id = ?'),
    assists: db.query<{ json: string }, []>('select json from assists'),
    assistsFor: db.query<{ json: string }, [string]>('select json from assists where msg_id = ?'),
    putAssist: db.query('insert into assists (id, chat_id, msg_id, json) values (?, ?, ?, ?) on conflict(id) do update set json = excluded.json'),
    addEvent: db.query('insert into events (json) values (?)'),
    events: db.query<{ seq: number; json: string }, [number]>('select seq, json from events where seq > ? order by seq'),
    lastSeq: db.query<{ s: number | null }, []>('select max(seq) as s from events'),
    firstSeq: db.query<{ s: number | null }, []>('select min(seq) as s from events'),
    trim: db.query('delete from events where seq <= ?'),
    devicesOf: db.query<{ device_id: string; user_id: string; box_pub: string; sign_pub: string; name: string; fetched_at: number }, [string]>('select * from devices where user_id = ?'),
    device: db.query<{ device_id: string; user_id: string; box_pub: string; sign_pub: string; name: string }, [string]>('select * from devices where device_id = ?'),
    dropDevices: db.query('delete from devices where user_id = ?'),
    putDevice: db.query('insert into devices (device_id, user_id, box_pub, sign_pub, name, fetched_at) values (?, ?, ?, ?, ?, ?) on conflict(device_id) do update set user_id = excluded.user_id, box_pub = excluded.box_pub, sign_pub = excluded.sign_pub, name = excluded.name, fetched_at = excluded.fetched_at'),
    pushOut: db.query('insert into outbox (frame) values (?)'),
    outbox: db.query<{ id: number; frame: string }, []>('select id, frame from outbox order by id'),
    dropOut: db.query('delete from outbox where id = ?'),
  }

  const toDevice = (r: { device_id: string; user_id: string; box_pub: string; sign_pub: string; name: string }): Device => ({ deviceId: r.device_id, userId: r.user_id, boxPub: r.box_pub, signPub: r.sign_pub, name: r.name })

  return {
    db,
    get: (key: string) => q.kvGet.get(key)?.value,
    set: (key: string, value: string) => void q.kvSet.run(key, value),

    user: (id: string): Json | undefined => parse(q.user.get(id)),
    users: (): Json[] => q.users.all().map(parse),
    putUser: (u: Json) => void q.putUser.run(u.id, JSON.stringify(u)),

    chat: (id: string): Json | undefined => parse(q.chat.get(id)),
    chats: (): Json[] => q.chats.all().map(parse),
    putChat: (c: Json, lastTs = 0) => void q.putChat.run(c.id, JSON.stringify(c), lastTs),

    message: (id: string): Json | undefined => parse(q.msg.get(id)),
    messages: (chatId: string, limit = 200): Json[] => q.recent.all(chatId, limit).map(parse),
    putMessage: (m: Json) => void q.putMsg.run(m.id, m.chatId, m.ts, JSON.stringify(m)),

    assist: (id: string): Json | undefined => parse(q.assist.get(id)),
    assists: (): Json[] => q.assists.all().map(parse),
    assistsFor: (msgId: string): Json[] => q.assistsFor.all(msgId).map(parse),
    putAssist: (a: Json) => void q.putAssist.run(a.id, a.chatId, a.msgId ?? null, JSON.stringify(a)),

    // Append a UI event; returns it stamped with seq.
    addEvent(ev: Json): Json {
      const res = q.addEvent.run(JSON.stringify(ev))
      const seq = Number(res.lastInsertRowid)
      if (seq % 500 === 0) q.trim.run(seq - KEEP_EVENTS)
      return { ...ev, seq }
    },
    events: (since: number): Json[] => q.events.all(since).map((r) => ({ ...JSON.parse(r.json), seq: r.seq })),
    seq: () => q.lastSeq.get()?.s ?? 0,
    firstSeq: () => q.firstSeq.get()?.s ?? 0,

    devicesOf: (userId: string) => q.devicesOf.all(userId).map(toDevice),
    devicesFetchedAt: (userId: string) => q.devicesOf.all(userId)[0]?.fetched_at ?? 0,
    device: (id: string) => {
      const r = q.device.get(id)
      return r ? toDevice(r) : undefined
    },
    // Replace a user's device list with what the server says now.
    setDevices(userId: string, list: Device[]) {
      db.transaction(() => {
        q.dropDevices.run(userId)
        const at = Date.now()
        for (const d of list) q.putDevice.run(d.deviceId, userId, d.boxPub, d.signPub, d.name ?? '', at)
      })()
    },

    queueFrame: (frame: Json) => void q.pushOut.run(JSON.stringify(frame)),
    outbox: () => q.outbox.all().map((r) => ({ id: r.id, frame: JSON.parse(r.frame) })),
    dropFrame: (id: number) => void q.dropOut.run(id),

    close: () => db.close(),
  }
}

export type Store = ReturnType<typeof openStore>
