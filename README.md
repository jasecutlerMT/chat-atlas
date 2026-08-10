# Chat Atlas

**A private, self-updating visual map of your Claude.ai conversation history.**

Chat Atlas turns the data export from claude.ai into something you can actually
explore: a map of every conversation, instant search across every message,
and a shelf of everything Claude has ever made for you — briefs, drafts,
plans, scripts and code. Everything happens inside your own browser, on your
own computer. Nothing is ever uploaded anywhere.

---

## Starting it up

You only need to do this once per sitting. Open the **Terminal** app, then
copy-paste these three lines one at a time and press Enter after each:

```
cd path/to/this/folder/chat-atlas
npm install
npm run dev
```

In plain English:

1. `cd …/chat-atlas` — walks the Terminal into this app's folder.
2. `npm install` — downloads the app's building blocks (only needed the
   first time, or after an update).
3. `npm run dev` — switches the app on.

The Terminal will then show a line like `Local: http://localhost:5173/`.
Open **Chrome** and go to **http://localhost:5173** — that's Chat Atlas.
Leave the Terminal window open while you use it; closing it switches the
app off (your data is safe either way).

> **Why Chrome?** The automatic-updating feature uses a folder-watching
> ability that only Chrome (and Edge) have. In other browsers everything
> still works — you just drag new exports in by hand.

## Getting your conversations in

1. On **claude.ai**, click your initials (bottom-left) → **Settings** →
   **Privacy** → **Export data**. Claude emails you a link to a zip file.
2. Download the zip. That's the last click you ever need to make.

The first time Chat Atlas opens, it asks to be pointed at your **Downloads**
folder. Say yes once, and from then on every new export you download is
noticed within about 30 seconds, unpacked, merged in, and announced with a
little "5 new conversations, 3 updated" message — no page reload, no
re-importing, no duplicates.

Prefer to do it by hand? Drag the zip anywhere onto the window, or use the
**Import** button, any time.

## What's inside

- **Map** — the home screen. Every conversation is a dot; bigger dots mean
  longer conversations; lines connect conversations that talk about the same
  things. Colour by topic or by month, drag the "Connections" slider to show
  more or fewer lines, pause the motion if it distracts you. Hover for a
  preview, click to read.
- **Search** — the big bar floating at the top. It searches every word you
  or Claude ever wrote (attachments included), tolerates typos, and lights up
  matching conversations on the map as you type. Filters let you narrow by
  date, by who said it, and by content ("has code", "has a table",
  "long-form", "has attachment"). Clicking a result opens the conversation
  scrolled to that exact message, highlighted.
- **Outputs** — every deliverable Claude produced, automatically found and
  labelled: Research brief, Email or message draft, Script, Plan or
  framework, Document, Code. Copy any of them with one click, save as a
  file, or jump to where it came from.
- **Timeline** — the same conversations laid out along time. Scroll to zoom,
  drag to pan.
- **All chats** — a simple sortable list of everything.
- **Projects & workspaces** — if your export says which Project a
  conversation belongs to (yours does — e.g. "Career"), a selector in the
  top bar narrows the whole app to it, and Chat Atlas starts there by
  default. You can also build your own named groups ("workspaces") by
  hand-picking conversations, with search and select-all-by-date-range to
  make that quick.
- **Reading pane** — full conversations with proper formatting, a copy
  button on every message and every code block, readable attachments, and a
  "Save as file" button that gives you the whole conversation as a markdown
  file.

## Your privacy, concretely

- The app makes **zero network requests** — no analytics, no fonts from the
  internet, no "checking for updates". Once it's running you could unplug
  the internet and nothing would change.
- Your conversations live in your browser's own built-in database
  (IndexedDB), on your disk, and nowhere else.
- The git settings for this folder refuse to ever commit zip files or
  exported conversation data, so your history can't accidentally end up in
  the repository.

## When something looks off

- **"1 item skipped" in the top bar** — part of an export was in a shape the
  app didn't recognise. Everything readable was kept; click the link to see
  exactly what was left out and why, in plain English.
- **"Allow watching again" button** — Chrome sometimes asks for a fresh
  one-click permission after a restart. Click it once and watching resumes.
- **The yellow-ish banner about old data** — your newest saved chat is more
  than a week old. It's just a nudge to export again; dismiss it freely.
- **Big export feels slow to import** — the heavy work runs in a background
  thread with a progress card in the corner. The app stays usable while it
  chews.

## For the technically curious

Vite + React + TypeScript. Parsing, merging, search indexing (MiniSearch)
and the similarity maths (TF-IDF + cosine similarity) all run in a Web
Worker. Storage is IndexedDB via `idb`; zips are read with `jszip`; the map
is `react-force-graph-2d`; markdown is `react-markdown` + `remark-gfm`.
Data intake is a swappable adapter (`src/adapters/`): if an official live
API for chat history ever ships, a new adapter can feed the same pipeline
without touching the rest of the app.
