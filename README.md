# WA Lead Folders

A small Chrome extension that adds a local lead desk to WhatsApp Web.

## What it does

- Links folders to WhatsApp's own lists (Business labels): a linked tab opens that list so every member is reachable, rows seen there are imported into the folder, and assigning a folder adds or removes the list on the open chat. Lead tools → **WhatsApp lists** sets the links.
- Remembers each chat's WhatsApp id (and phone, when WhatsApp exposes it) the first time it is opened, so saved leads reopen by number instead of by name.
- Groups chats into persistent tabs such as **Wholesalers** and **Retailers**, so a long group never pushes the other groups out of view.
- Keeps saved leads that are outside WhatsApp's current All list visible directly inside their group tab.
- Suggests folders, scores visible lead forms, and holds uncertain forms in a review queue.
- Counts chats with unread messages and due follow-ups in each group tab.
- Schedules follow-up automatically after assignment (24 hours by default) and keeps the group tab strip available while scrolling.
- Supports one-click row assignment, undoable bulk grouping, folder quick replies, and editable folder names.
- Adds an opt-in keyboard triage mode: **1-9** assigns a folder, **F** schedules follow-up, **Q** inserts the next reply, and **N** opens the next lead.
- Lets every folder define its own matching phrases and a three-step quick-reply sequence through native in-page dialogs.
- Extracts company, activity, volume, campaign, phone, and full name into the lead record and CSV export.
- Records whether an assignment was manual or automatic and offers an explicit duplicate-identity reconciliation action.
- Filters WhatsApp chats by due, overdue, waiting, or unassigned status from the active chat header.
- Shows the active lead's score, folder selector, and follow-up date directly in the WhatsApp header.
- Keeps the green launcher panel for folder settings, quick replies, and data tools.
- Places that settings launcher in WhatsApp's left utility rail after a native-style separator.
- Exports leads to CSV and backs up/restores the complete local desk as JSON.
- Stores everything in `chrome.storage.local`; no server, tracking, message sending, or contact upload.
- Shares the locally indexed WhatsApp phone list with Meta Business Inbox to confirm cross-channel leads without opening their Meta WhatsApp thread first.
- Highlights Algerian phone numbers in Meta Inbox with one-click Message, Call, and Copy actions while reusing the existing WhatsApp Web tab.
- Records Meta outcomes (**Has WhatsApp**, **Messaged on WA**, **No WhatsApp**, **Invalid phone**, or **Converted**) and advances to the next unchecked lead.
- Persists Messenger leads as Meta lazy-loads them and renders the unchecked filter from that cumulative index, so discovered leads and the badge count no longer disappear when Meta unmounts off-screen rows.
- Saves Meta's exact Messenger thread route and reopens discovered leads by `selected_item_id`, while mounted rows still use Meta's native click navigation.
- Carries the most recently opened phone into WhatsApp briefly so an existing conversation can confirm availability even after WhatsApp removes the phone from its URL.
- Uses extension-owned in-page forms for names, rules, replies, and confirmations; it never opens browser prompt or confirm alerts.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Reload [WhatsApp Web](https://web.whatsapp.com/).
5. Open a lead chat, click the green folder button, choose a folder, and press **Add**.

Disable the older **WhatsApp Quick Contact** extension and reload Meta Inbox to avoid duplicate phone highlights.

WhatsApp lists are driven through WhatsApp's visible UI (filter chips and the chat header's list menu). If a list stops syncing, open a chat, then Lead tools → **Copy structure report**: it copies an anonymised outline (digits masked, no message text) to share when updating the selectors.

WhatsApp Web changes its private page markup occasionally. If chat detection stops working, update the selectors in `content.js`.

## Check

```powershell
node --test tests/classifier.test.js
```
