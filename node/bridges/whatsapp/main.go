// yap-wa: the yapping node's WhatsApp sidecar.
//
// It links this Mac to the person's WhatsApp account as a "linked device"
// (whatsmeow) and speaks newline-delimited JSON with the node over stdio.
// Nothing leaves this Mac except the WhatsApp connection itself: the session
// keys and a small cache of recent messages live in
// $YAP_HOME/bridges/whatsapp/ (folder 700, files 600).
//
// Commands (node → sidecar, one JSON object per line on stdin):
//
//	{"id":1,"cmd":"link"}                       start pairing; QR codes follow as `qr` events
//	{"id":2,"cmd":"status"}                     → {status, connected, account?}
//	{"id":3,"cmd":"unlink"}                     log this device out and forget the session
//	{"id":4,"cmd":"send","jid":"…","text":"…","replyTo":"…"}  → {msgId, ts}
//	{"id":5,"cmd":"history","jid":"…","limit":50}             → {messages:[…]} from the local cache
//	{"id":6,"cmd":"chats"}                      → {chats:[{jid,name,isGroup,lastTs}]}
//
// Every command gets one reply: {"type":"result","id":…,"ok":true,…} or
// {"type":"result","id":…,"ok":false,"code":"…","error":"…"}.
//
// Events (sidecar → node, one JSON object per line on stdout):
//
//	ready      {version, linked}                         once, at start
//	qr         {code, expiresAt}                         each time the code rotates (expiresAt in ms)
//	connected  {account:{name, phone, jid}}              logged in and online
//	disconnected {}                                      socket dropped (whatsmeow reconnects by itself)
//	logged_out {reason}                                  the phone removed this device, or `unlink`
//	message    {jid, chatName, isGroup, from:{jid,name}, id, ts, text, fromMe, quoted?, history?}
//	receipt    {jid, ids, kind, ts, from}
//	error      {code, message}
//
// Logs go to stderr and never include message text.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

const version = "0.1.0"

// ── Output ────────────────────────────────────────────────────────────────

var outMu sync.Mutex
var outEnc = json.NewEncoder(os.Stdout)

type obj = map[string]any

// emit writes one event line. Safe from any goroutine.
func emit(typ string, fields obj) {
	if fields == nil {
		fields = obj{}
	}
	fields["type"] = typ
	outMu.Lock()
	defer outMu.Unlock()
	outEnc.SetEscapeHTML(false)
	_ = outEnc.Encode(fields)
}

func reply(id any, fields obj) {
	if fields == nil {
		fields = obj{}
	}
	fields["id"] = id
	fields["ok"] = true
	emit("result", fields)
}

func fail(id any, code string, err error) {
	emit("result", obj{"id": id, "ok": false, "code": code, "error": err.Error()})
}

// ── Logging (stderr only) ─────────────────────────────────────────────────

type logger struct {
	mod   string
	debug bool
}

func (l logger) out(level, msg string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s [%s %s] %s\n", time.Now().Format("15:04:05"), l.mod, level, fmt.Sprintf(msg, args...))
}
func (l logger) Warnf(msg string, args ...any)  { l.out("WARN", msg, args...) }
func (l logger) Errorf(msg string, args ...any) { l.out("ERROR", msg, args...) }
func (l logger) Infof(msg string, args ...any) {
	if l.debug {
		l.out("INFO", msg, args...)
	}
}
func (l logger) Debugf(msg string, args ...any) {
	if l.debug {
		l.out("DEBUG", msg, args...)
	}
}
func (l logger) Sub(mod string) waLog.Logger { return logger{mod: l.mod + "/" + mod, debug: l.debug} }

// ── The sidecar ───────────────────────────────────────────────────────────

type sidecar struct {
	dir       string
	log       logger
	container *sqlstore.Container
	cache     *cache
	days      int
	perChat   int

	mu      sync.Mutex
	client  *whatsmeow.Client
	linking bool
	lastQR  obj
	stopQR  context.CancelFunc

	namesMu    sync.Mutex
	groupNames map[string]string
	histCount  map[string]int
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return def
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("yap-wa", version)
		return
	}
	home := os.Getenv("YAP_HOME")
	if home == "" {
		h, _ := os.UserHomeDir()
		home = filepath.Join(h, ".yapping")
	}
	s := &sidecar{
		dir:        filepath.Join(home, "bridges", "whatsapp"),
		log:        logger{mod: "yap-wa", debug: os.Getenv("YAP_WA_DEBUG") != ""},
		days:       envInt("YAP_WA_HISTORY_DAYS", 30),
		perChat:    envInt("YAP_WA_HISTORY_PER_CHAT", 50),
		groupNames: map[string]string{},
		histCount:  map[string]int{},
	}
	if err := s.open(); err != nil {
		emit("error", obj{"code": "start_failed", "message": err.Error()})
		os.Exit(1)
	}
	emit("ready", obj{"version": version, "linked": s.cl().Store.ID != nil})
	if s.cl().Store.ID != nil {
		go s.connect()
	}

	// Leave cleanly when the node goes away (stdin closes) or asks us to.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	done := make(chan struct{})
	go func() { s.readCommands(); close(done) }()
	select {
	case <-done:
	case <-sig:
	}
	s.cl().Disconnect()
	s.cache.close()
	os.Exit(0)
}

func (s *sidecar) open() error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(s.dir, 0o700)

	// Say who we are on the phone's "Linked devices" list, and keep the
	// first sync small: we only import recent chats.
	store.SetOSInfo("yapping (Mac)", [3]uint32{0, 1, 0})
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_DESKTOP.Enum()
	store.DeviceProps.RequireFullSync = proto.Bool(false)
	hs := store.DeviceProps.HistorySyncConfig
	hs.FullSyncDaysLimit = proto.Uint32(uint32(s.days))
	hs.RecentSyncDaysLimit = proto.Uint32(uint32(s.days))
	hs.FullSyncSizeMbLimit = proto.Uint32(64)
	hs.StorageQuotaMb = proto.Uint32(256)
	hs.InitialSyncMaxMessagesPerChat = proto.Uint32(uint32(s.perChat))

	sessionPath := filepath.Join(s.dir, "session.db")
	c, err := sqlstore.New(context.Background(), "sqlite3", "file:"+sessionPath+"?_foreign_keys=on&_busy_timeout=3000", s.log.Sub("db"))
	if err != nil {
		return fmt.Errorf("session store: %w", err)
	}
	s.container = c
	s.cache, err = openCache(filepath.Join(s.dir, "cache.db"))
	if err != nil {
		return fmt.Errorf("cache: %w", err)
	}
	s.privatise()
	return s.newClient()
}

// Messages and keys are the owner's alone.
func (s *sidecar) privatise() {
	for _, f := range []string{"session.db", "session.db-wal", "session.db-shm", "session.db-journal", "cache.db", "cache.db-wal", "cache.db-shm", "cache.db-journal"} {
		p := filepath.Join(s.dir, f)
		if _, err := os.Stat(p); err == nil {
			_ = os.Chmod(p, 0o600)
		}
	}
}

func (s *sidecar) newClient() error {
	dev, err := s.container.GetFirstDevice(context.Background())
	if err != nil {
		return fmt.Errorf("device: %w", err)
	}
	cli := whatsmeow.NewClient(dev, s.log.Sub("wa"))
	cli.AddEventHandler(s.onEvent)
	s.mu.Lock()
	s.client = cli
	s.mu.Unlock()
	return nil
}

func (s *sidecar) cl() *whatsmeow.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.client
}

func (s *sidecar) connect() {
	cli := s.cl()
	if cli.IsConnected() {
		return
	}
	if err := cli.Connect(); err != nil {
		emit("error", obj{"code": "connect_failed", "message": err.Error()})
	}
}

func (s *sidecar) account() obj {
	cli := s.cl()
	if cli.Store.ID == nil {
		return nil
	}
	return obj{"name": cli.Store.PushName, "phone": "+" + cli.Store.ID.User, "jid": cli.Store.ID.ToNonAD().String()}
}

func (s *sidecar) statusName() string {
	s.mu.Lock()
	linking := s.linking
	s.mu.Unlock()
	if s.cl().Store.ID != nil {
		return "linked"
	}
	if linking {
		return "linking"
	}
	return "unlinked"
}

// ── Commands ──────────────────────────────────────────────────────────────

type command struct {
	ID      any    `json:"id"`
	Cmd     string `json:"cmd"`
	Type    string `json:"type"`
	JID     string `json:"jid"`
	Text    string `json:"text"`
	ReplyTo string `json:"replyTo"`
	Limit   int    `json:"limit"`
}

func (s *sidecar) readCommands() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var c command
		if err := json.Unmarshal(line, &c); err != nil {
			emit("error", obj{"code": "bad_command", "message": "not JSON: " + err.Error()})
			continue
		}
		if c.Cmd == "" {
			c.Cmd = c.Type
		}
		go s.handle(c)
	}
}

func (s *sidecar) handle(c command) {
	defer func() {
		if r := recover(); r != nil {
			fail(c.ID, "internal", fmt.Errorf("%v", r))
		}
	}()
	switch c.Cmd {
	case "link":
		s.link(c)
	case "status":
		r := obj{"status": s.statusName(), "connected": s.cl().IsConnected()}
		if a := s.account(); a != nil {
			r["account"] = a
		}
		reply(c.ID, r)
	case "unlink":
		s.unlink(c)
	case "send":
		s.send(c)
	case "history":
		limit := c.Limit
		if limit <= 0 || limit > 500 {
			limit = 50
		}
		msgs, err := s.cache.history(c.JID, limit)
		if err != nil {
			fail(c.ID, "cache", err)
			return
		}
		reply(c.ID, obj{"messages": msgs})
	case "chats":
		chats, err := s.cache.chats()
		if err != nil {
			fail(c.ID, "cache", err)
			return
		}
		reply(c.ID, obj{"chats": chats})
	case "ping":
		reply(c.ID, obj{"version": version})
	default:
		fail(c.ID, "unknown_command", fmt.Errorf("unknown command %q", c.Cmd))
	}
}

func (s *sidecar) link(c command) {
	cli := s.cl()
	if cli.Store.ID != nil {
		go s.connect()
		reply(c.ID, obj{"status": "linked", "account": s.account()})
		return
	}
	s.mu.Lock()
	if s.linking {
		last := s.lastQR
		s.mu.Unlock()
		reply(c.ID, obj{"status": "linking"})
		// Show the current code again to whoever just asked.
		if last != nil {
			emit("qr", obj{"code": last["code"], "expiresAt": last["expiresAt"]})
		}
		return
	}
	s.linking = true
	s.lastQR = nil
	s.mu.Unlock()

	if cli.IsConnected() {
		cli.Disconnect()
	}
	ctx, cancel := context.WithCancel(context.Background())
	qrs, err := cli.GetQRChannel(ctx)
	if err != nil {
		cancel()
		s.endLinking()
		fail(c.ID, "link_failed", err)
		return
	}
	if err := cli.Connect(); err != nil {
		cancel()
		s.endLinking()
		fail(c.ID, "connect_failed", err)
		return
	}
	s.mu.Lock()
	s.stopQR = cancel
	s.mu.Unlock()
	reply(c.ID, obj{"status": "linking"})

	go func() {
		defer cancel()
		for item := range qrs {
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				q := obj{"code": item.Code, "expiresAt": time.Now().Add(item.Timeout).UnixMilli()}
				s.mu.Lock()
				s.lastQR = q
				s.mu.Unlock()
				emit("qr", obj{"code": q["code"], "expiresAt": q["expiresAt"]})
			case whatsmeow.QRChannelSuccess.Event:
				s.endLinking()
				return // `connected` follows from the Connected event
			case whatsmeow.QRChannelTimeout.Event:
				s.endLinking()
				emit("error", obj{"code": "qr_timeout", "message": "Nobody scanned the code in time. Ask for a new one."})
				cli.Disconnect()
				return
			case whatsmeow.QRChannelEventError:
				s.endLinking()
				msg := "pairing failed"
				if item.Error != nil {
					msg = item.Error.Error()
				}
				emit("error", obj{"code": "pair_failed", "message": msg})
				return
			default:
				if item.Event == whatsmeow.QRChannelEventPasskeyRequest || item.Event == whatsmeow.QRChannelEventPasskeyResponse {
					continue
				}
				s.endLinking()
				emit("error", obj{"code": item.Event, "message": "WhatsApp refused to pair: " + item.Event})
				return
			}
		}
	}()
}

func (s *sidecar) endLinking() {
	s.mu.Lock()
	s.linking = false
	s.lastQR = nil
	s.stopQR = nil
	s.mu.Unlock()
}

func (s *sidecar) unlink(c command) {
	cli := s.cl()
	s.mu.Lock()
	if s.stopQR != nil {
		s.stopQR()
	}
	s.mu.Unlock()
	s.endLinking()
	if cli.Store.ID != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := cli.Logout(ctx)
		cancel()
		if err != nil {
			// Couldn't tell WhatsApp; forget the session here anyway.
			s.log.Warnf("logout: %v", err)
			cli.Disconnect()
			_ = cli.Store.Delete(context.Background())
		}
	} else {
		cli.Disconnect()
	}
	s.cache.clear()
	s.clearNames()
	if err := s.newClient(); err != nil {
		fail(c.ID, "reset_failed", err)
		return
	}
	emit("logged_out", obj{"reason": "unlinked"})
	reply(c.ID, obj{"status": "unlinked"})
}

func (s *sidecar) clearNames() {
	s.namesMu.Lock()
	s.groupNames = map[string]string{}
	s.histCount = map[string]int{}
	s.namesMu.Unlock()
}

func (s *sidecar) send(c command) {
	cli := s.cl()
	if cli.Store.ID == nil {
		fail(c.ID, "not_linked", errors.New("WhatsApp isn't linked on this Mac"))
		return
	}
	if c.Text == "" {
		fail(c.ID, "bad_request", errors.New("nothing to send"))
		return
	}
	to, err := types.ParseJID(c.JID)
	if err != nil || to.User == "" {
		fail(c.ID, "bad_jid", fmt.Errorf("not a WhatsApp chat: %q", c.JID))
		return
	}
	msg := buildText(c.Text, c.ReplyTo, s.quotedFor(to, c.ReplyTo))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	resp, err := cli.SendMessage(ctx, to, msg)
	if err != nil {
		code := "send_failed"
		if errors.Is(err, whatsmeow.ErrNotConnected) {
			code = "not_connected"
		}
		fail(c.ID, code, err)
		return
	}
	ts := resp.Timestamp.UnixMilli()
	if ts <= 0 {
		ts = time.Now().UnixMilli()
	}
	me := cli.Store.ID.ToNonAD()
	s.cache.putMessage(cachedMsg{JID: to.ToNonAD().String(), ID: resp.ID, Sender: me.String(), SenderName: cli.Store.PushName, TS: ts, Text: c.Text, FromMe: true, ReplyTo: c.ReplyTo})
	reply(c.ID, obj{"msgId": resp.ID, "ts": ts})
}

// ── Events from WhatsApp ──────────────────────────────────────────────────

func (s *sidecar) onEvent(evt any) {
	switch v := evt.(type) {
	case *events.Connected:
		s.privatise()
		if a := s.account(); a != nil {
			emit("connected", obj{"account": a})
		}
	case *events.PushNameSetting:
		if a := s.account(); a != nil {
			emit("connected", obj{"account": a})
		}
	case *events.Disconnected:
		emit("disconnected", nil)
	case *events.LoggedOut:
		s.cache.clear()
		s.clearNames()
		reason := "logged_out"
		if v.OnConnect {
			reason = v.Reason.String()
		}
		go func() {
			// whatsmeow has already deleted the session; start a fresh one so
			// a later `link` works without a restart.
			if err := s.newClient(); err != nil {
				emit("error", obj{"code": "reset_failed", "message": err.Error()})
			}
			emit("logged_out", obj{"reason": reason})
		}()
	case *events.StreamReplaced:
		emit("error", obj{"code": "stream_replaced", "message": "Another copy of this WhatsApp link connected elsewhere."})
	case *events.TemporaryBan:
		emit("error", obj{"code": "temporary_ban", "message": v.String()})
	case *events.ClientOutdated:
		emit("error", obj{"code": "client_outdated", "message": "WhatsApp says this client is outdated. yapping needs an update."})
	case *events.ConnectFailure:
		emit("error", obj{"code": "connect_failure", "message": fmt.Sprintf("%v %s", v.Reason, v.Message)})
	case *events.Message:
		if m := s.toMessage(v, false); m != nil {
			emit("message", m)
		}
	case *events.HistorySync:
		s.onHistory(v)
	case *events.Receipt:
		kind := string(v.Type)
		if kind == "" {
			kind = "delivered"
		}
		chat := s.canon(v.Chat, types.EmptyJID)
		emit("receipt", obj{"jid": chat.String(), "ids": v.MessageIDs, "kind": kind, "ts": v.Timestamp.UnixMilli(), "from": s.canon(v.Sender, types.EmptyJID).String()})
	case *events.GroupInfo:
		if v.Name != nil {
			s.namesMu.Lock()
			s.groupNames[v.JID.String()] = v.Name.Name
			s.namesMu.Unlock()
		}
	}
}

// The initial import: only recent chats, only the newest messages in each.
func (s *sidecar) onHistory(v *events.HistorySync) {
	cutoff := time.Now().Add(-time.Duration(s.days) * 24 * time.Hour)
	cli := s.cl()
	sent := 0
	for _, conv := range v.Data.GetConversations() {
		chat, err := types.ParseJID(conv.GetID())
		if err != nil || skipChat(chat) {
			continue
		}
		if name := conv.GetName(); name != "" && chat.Server == types.GroupServer {
			s.namesMu.Lock()
			s.groupNames[chat.String()] = name
			s.namesMu.Unlock()
		}
		var parsed []*events.Message
		for _, hm := range conv.GetMessages() {
			if hm.GetMessage() == nil {
				continue
			}
			ev, err := cli.ParseWebMessage(chat, hm.GetMessage())
			if err != nil || ev.Info.Timestamp.Before(cutoff) {
				continue
			}
			parsed = append(parsed, ev)
		}
		// Newest first, then keep what's left of this chat's allowance.
		sortByTimeDesc(parsed)
		key := s.canon(chat, types.EmptyJID).String()
		s.namesMu.Lock()
		room := s.perChat - s.histCount[key]
		s.namesMu.Unlock()
		if room <= 0 {
			continue
		}
		var out []obj
		for _, ev := range parsed {
			if len(out) >= room {
				break
			}
			if m := s.toMessage(ev, true); m != nil {
				out = append(out, m)
			}
		}
		s.namesMu.Lock()
		s.histCount[key] += len(out)
		s.namesMu.Unlock()
		for i := len(out) - 1; i >= 0; i-- { // oldest first
			emit("message", out[i])
			sent++
		}
	}
	s.log.Infof("history sync %v: %d messages", v.Data.GetSyncType(), sent)
}

func skipChat(j types.JID) bool {
	return j.User == "" || j.Server == types.BroadcastServer || j.Server == types.NewsletterServer || j.Server == "call" || j.String() == "status@broadcast"
}

// The phone-number JID for a person when we know it, so a chat keeps one id
// whether WhatsApp addressed it by phone number or by LID.
func (s *sidecar) canon(j, alt types.JID) types.JID {
	j = j.ToNonAD()
	if j.Server != types.HiddenUserServer {
		return j
	}
	if !alt.IsEmpty() && alt.Server == types.DefaultUserServer {
		return alt.ToNonAD()
	}
	if pn, err := s.cl().Store.LIDs.GetPNForLID(context.Background(), j); err == nil && !pn.IsEmpty() {
		return pn.ToNonAD()
	}
	return j
}

func (s *sidecar) contactName(j types.JID, push string) string {
	if c, err := s.cl().Store.Contacts.GetContact(context.Background(), j); err == nil && c.Found {
		for _, n := range []string{c.FullName, c.FirstName, c.BusinessName, c.PushName} {
			if n != "" {
				return n
			}
		}
	}
	if push != "" && push != "-" {
		return push
	}
	if j.Server == types.DefaultUserServer {
		return "+" + j.User
	}
	return "WhatsApp contact"
}

func (s *sidecar) groupName(j types.JID) string {
	key := j.String()
	s.namesMu.Lock()
	name, ok := s.groupNames[key]
	s.namesMu.Unlock()
	if ok {
		return name
	}
	if n := s.cache.chatName(key); n != "" {
		name = n
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		info, err := s.cl().GetGroupInfo(ctx, j)
		cancel()
		if err == nil && info.Name != "" {
			name = info.Name
		} else {
			name = "WhatsApp group"
		}
	}
	s.namesMu.Lock()
	s.groupNames[key] = name
	s.namesMu.Unlock()
	return name
}

func (s *sidecar) toMessage(ev *events.Message, history bool) obj {
	info := ev.Info
	if skipChat(info.Chat) || info.Chat.Server == types.BroadcastServer {
		return nil
	}
	text, q := describe(ev.Message)
	if text == "" {
		return nil // reactions, receipts, protocol messages… nothing to show
	}
	cli := s.cl()
	isGroup := info.Chat.Server == types.GroupServer
	var chat types.JID
	if isGroup {
		chat = info.Chat.ToNonAD()
	} else {
		alt := info.SenderAlt
		if info.IsFromMe {
			alt = info.RecipientAlt
		}
		chat = s.canon(info.Chat, alt)
	}
	var from types.JID
	var fromName string
	if info.IsFromMe && cli.Store.ID != nil {
		from = cli.Store.ID.ToNonAD()
		fromName = cli.Store.PushName
		if fromName == "" {
			fromName = "You"
		}
	} else {
		from = s.canon(info.Sender, info.SenderAlt)
		fromName = s.contactName(from, info.PushName)
	}
	var chatName string
	if isGroup {
		chatName = s.groupName(chat)
	} else if info.IsFromMe {
		chatName = s.contactName(chat, "")
	} else {
		chatName = fromName
	}
	ts := info.Timestamp.UnixMilli()
	m := obj{
		"jid":      chat.String(),
		"chatName": chatName,
		"isGroup":  isGroup,
		"from":     obj{"jid": from.String(), "name": fromName, "phone": phoneOf(from)},
		"id":       info.ID,
		"ts":       ts,
		"text":     text,
		"fromMe":   info.IsFromMe,
	}
	if history {
		m["history"] = true
	}
	replyTo := ""
	if q != nil {
		replyTo = q.ID
		qo := obj{"id": q.ID}
		if q.Text != "" {
			qo["text"] = q.Text
		}
		if q.Sender != "" {
			if pj, err := types.ParseJID(q.Sender); err == nil {
				qo["from"] = s.canon(pj, types.EmptyJID).String()
			}
		}
		m["quoted"] = qo
	}
	s.cache.putChat(chat.String(), chatName, isGroup, ts)
	s.cache.putMessage(cachedMsg{JID: chat.String(), ID: info.ID, Sender: from.String(), SenderName: fromName, TS: ts, Text: text, FromMe: info.IsFromMe, ReplyTo: replyTo})
	return m
}

func phoneOf(j types.JID) string {
	if j.Server == types.DefaultUserServer && j.User != "" {
		return "+" + j.User
	}
	return ""
}

// Who wrote the message being replied to, and what it said, for the quote
// bubble WhatsApp shows.
func (s *sidecar) quotedFor(chat types.JID, id string) *quote {
	if id == "" {
		return nil
	}
	q := &quote{ID: id}
	if m, ok := s.cache.message(chat.ToNonAD().String(), id); ok {
		q.Text = m.Text
		q.Sender = m.Sender
		return q
	}
	if chat.Server != types.GroupServer {
		q.Sender = chat.ToNonAD().String()
	}
	return q
}
