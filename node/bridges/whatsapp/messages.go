package main

import (
	"sort"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type quote struct {
	ID     string
	Sender string
	Text   string
}

// describe turns a WhatsApp message into the one line yapping shows. Text
// comes through as is; everything else becomes a plain label like "[photo]"
// (with its caption, if any). Returns "" for things that aren't messages a
// person wrote: reactions, edits, deletions, key exchanges.
func describe(m *waE2E.Message) (string, *quote) {
	if m == nil {
		return "", nil
	}
	label := func(tag, caption string) string {
		caption = strings.TrimSpace(caption)
		if caption == "" {
			return tag
		}
		return tag + " " + caption
	}
	var text string
	var ctx *waE2E.ContextInfo
	switch {
	case m.GetConversation() != "":
		text = m.GetConversation()
	case m.GetExtendedTextMessage() != nil:
		text = m.GetExtendedTextMessage().GetText()
		ctx = m.GetExtendedTextMessage().GetContextInfo()
	case m.GetImageMessage() != nil:
		text = label("[photo]", m.GetImageMessage().GetCaption())
		ctx = m.GetImageMessage().GetContextInfo()
	case m.GetVideoMessage() != nil:
		tag := "[video]"
		if m.GetVideoMessage().GetGifPlayback() {
			tag = "[GIF]"
		}
		text = label(tag, m.GetVideoMessage().GetCaption())
		ctx = m.GetVideoMessage().GetContextInfo()
	case m.GetPtvMessage() != nil:
		text = "[video note]"
		ctx = m.GetPtvMessage().GetContextInfo()
	case m.GetAudioMessage() != nil:
		text = "[audio]"
		if m.GetAudioMessage().GetPTT() {
			text = "[voice note]"
		}
		ctx = m.GetAudioMessage().GetContextInfo()
	case m.GetDocumentMessage() != nil:
		d := m.GetDocumentMessage()
		tag := "[document]"
		if name := d.GetFileName(); name != "" {
			tag = "[document: " + name + "]"
		}
		text = label(tag, d.GetCaption())
		ctx = d.GetContextInfo()
	case m.GetStickerMessage() != nil:
		text = "[sticker]"
		ctx = m.GetStickerMessage().GetContextInfo()
	case m.GetLocationMessage() != nil:
		text = "[location]"
		if n := m.GetLocationMessage().GetName(); n != "" {
			text = "[location: " + n + "]"
		}
		ctx = m.GetLocationMessage().GetContextInfo()
	case m.GetLiveLocationMessage() != nil:
		text = "[live location]"
		ctx = m.GetLiveLocationMessage().GetContextInfo()
	case m.GetContactMessage() != nil:
		text = "[contact]"
		if n := m.GetContactMessage().GetDisplayName(); n != "" {
			text = "[contact: " + n + "]"
		}
		ctx = m.GetContactMessage().GetContextInfo()
	case m.GetContactsArrayMessage() != nil:
		text = "[contacts]"
	case m.GetPollCreationMessage() != nil:
		text = "[poll: " + m.GetPollCreationMessage().GetName() + "]"
	case m.GetPollCreationMessageV2() != nil:
		text = "[poll: " + m.GetPollCreationMessageV2().GetName() + "]"
	case m.GetPollCreationMessageV3() != nil:
		text = "[poll: " + m.GetPollCreationMessageV3().GetName() + "]"
	case m.GetEventMessage() != nil:
		text = "[event: " + m.GetEventMessage().GetName() + "]"
	case m.GetGroupInviteMessage() != nil:
		text = "[group invite]"
	case m.GetProductMessage() != nil:
		text = "[product]"
	default:
		return "", nil
	}
	var q *quote
	if ctx != nil && ctx.GetStanzaID() != "" {
		q = &quote{ID: ctx.GetStanzaID(), Sender: ctx.GetParticipant()}
		if qm := ctx.GetQuotedMessage(); qm != nil {
			q.Text, _ = describe(qm)
		}
	}
	return text, q
}

// buildText is an outgoing text message, quoting another one when replying.
func buildText(text, replyTo string, q *quote) *waE2E.Message {
	if replyTo == "" || q == nil {
		return &waE2E.Message{Conversation: proto.String(text)}
	}
	ci := &waE2E.ContextInfo{StanzaID: proto.String(replyTo)}
	if q.Sender != "" {
		ci.Participant = proto.String(q.Sender)
	}
	if q.Text != "" {
		ci.QuotedMessage = &waE2E.Message{Conversation: proto.String(q.Text)}
	}
	return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String(text), ContextInfo: ci}}
}

func sortByTimeDesc(list []*events.Message) {
	sort.SliceStable(list, func(i, j int) bool { return list[i].Info.Timestamp.After(list[j].Info.Timestamp) })
}
