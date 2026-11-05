// /privacy: what yapping keeps, where, and who can see it. Plain words.

import { page } from './pages'

export function privacyPage() {
  return page('Privacy', `
    <h1>Privacy</h1>
    <p><b>Your messages stay on your Mac.</b> yapping keeps your chats in a small database on your own computer. Messages travel between people end to end encrypted: our server passes them along and holds them, still encrypted, only until the other person's Mac is back online. We can't read them.</p>
    <p><b>What our server keeps.</b> Your name, email or phone, and picture (from your sign-in with Clerk), the Macs you've linked, who you're connected to, and the private notes you keep about those connections. Plus the encrypted messages waiting for delivery, deleted once delivered or after 30 days.</p>
    <p><b>Your AI.</b> Claude, ChatGPT or Codex only sees a chat if you switch it on for that chat. When it reads one, those messages go to that AI company under its own terms. Nothing it prepares is sent until you press Send.</p>
    <p><b>WhatsApp.</b> If you link WhatsApp, the connection runs on your Mac and your WhatsApp messages stay there. WhatsApp doesn't allow third-party apps, so linking could get your account restricted.</p>
    <p><b>Deleting.</b> Remove a Mac from your account page and its messages stay only on that Mac. Ask us to delete your account and we remove everything on our server.</p>`)
}
