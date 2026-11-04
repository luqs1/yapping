package main

import (
	"database/sql"
	"sync"
)

// A small cache of recent chats and messages, so `history` and `chats` can
// answer without asking the phone, and replies can quote what they answer.
// It lives beside the session (mode 600) and keeps at most keepPerChat
// messages per chat. The node's own SQLite is the real record.
const keepPerChat = 200

type cache struct {
	db     *sql.DB
	mu     sync.Mutex
	writes int
}

type cachedMsg struct {
	JID        string `json:"jid"`
	ID         string `json:"id"`
	Sender     string `json:"from"`
	SenderName string `json:"fromName"`
	TS         int64  `json:"ts"`
	Text       string `json:"text"`
	FromMe     bool   `json:"fromMe"`
	ReplyTo    string `json:"replyTo,omitempty"`
}

func openCache(path string) (*cache, error) {
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=3000&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
create table if not exists chats (jid text primary key, name text not null default '', is_group integer not null default 0, last_ts integer not null default 0);
create table if not exists messages (jid text not null, id text not null, sender text not null, sender_name text not null default '', ts integer not null, text text not null, from_me integer not null default 0, reply_to text not null default '', primary key (jid, id));
create index if not exists messages_ts on messages (jid, ts);`)
	if err != nil {
		return nil, err
	}
	c := &cache{db: db}
	c.prune()
	return c, nil
}

func (c *cache) close() { _ = c.db.Close() }

func (c *cache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.db.Exec(`delete from messages; delete from chats;`)
}

func (c *cache) prune() {
	_, _ = c.db.Exec(`delete from messages where rowid in (select rowid from (select rowid, row_number() over (partition by jid order by ts desc) as rn from messages) where rn > ?)`, keepPerChat)
}

func (c *cache) putChat(jid, name string, isGroup bool, ts int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.db.Exec(`insert into chats (jid, name, is_group, last_ts) values (?, ?, ?, ?)
		on conflict(jid) do update set name = case when excluded.name != '' then excluded.name else chats.name end, last_ts = max(chats.last_ts, excluded.last_ts)`, jid, name, isGroup, ts)
}

func (c *cache) putMessage(m cachedMsg) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.db.Exec(`insert or replace into messages (jid, id, sender, sender_name, ts, text, from_me, reply_to) values (?, ?, ?, ?, ?, ?, ?, ?)`,
		m.JID, m.ID, m.Sender, m.SenderName, m.TS, m.Text, m.FromMe, m.ReplyTo)
	c.writes++
	if c.writes%500 == 0 {
		c.prune()
	}
}

func (c *cache) message(jid, id string) (cachedMsg, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var m cachedMsg
	err := c.db.QueryRow(`select jid, id, sender, sender_name, ts, text, from_me, reply_to from messages where jid = ? and id = ?`, jid, id).
		Scan(&m.JID, &m.ID, &m.Sender, &m.SenderName, &m.TS, &m.Text, &m.FromMe, &m.ReplyTo)
	return m, err == nil
}

func (c *cache) chatName(jid string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var name string
	_ = c.db.QueryRow(`select name from chats where jid = ?`, jid).Scan(&name)
	return name
}

// The newest `limit` messages of a chat, oldest first.
func (c *cache) history(jid string, limit int) ([]cachedMsg, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rows, err := c.db.Query(`select * from (select jid, id, sender, sender_name, ts, text, from_me, reply_to from messages where jid = ? order by ts desc limit ?) order by ts asc`, jid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cachedMsg{}
	for rows.Next() {
		var m cachedMsg
		if err := rows.Scan(&m.JID, &m.ID, &m.Sender, &m.SenderName, &m.TS, &m.Text, &m.FromMe, &m.ReplyTo); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type cachedChat struct {
	JID     string `json:"jid"`
	Name    string `json:"name"`
	IsGroup bool   `json:"isGroup"`
	LastTS  int64  `json:"lastTs"`
}

func (c *cache) chats() ([]cachedChat, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rows, err := c.db.Query(`select jid, name, is_group, last_ts from chats order by last_ts desc limit 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cachedChat{}
	for rows.Next() {
		var ch cachedChat
		if err := rows.Scan(&ch.JID, &ch.Name, &ch.IsGroup, &ch.LastTS); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}
