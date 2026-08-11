# Chat Atlas

**Your private library of everything Claude has ever made for you.**

Chat Atlas turns the data export from claude.ai into an organised, searchable
library: every research brief, email draft, plan, script and piece of advice,
sorted by the companies, people and tools they're about, ready to copy or to
save as a Word or PDF document. Everything happens inside your own browser,
on your own computer. Nothing is ever uploaded anywhere.

---

## The fastest way to start it: the Mac app

There's a real Mac app in this folder called **Chat Atlas** (it has an orange
constellation icon). Double-click it and it does everything: finds the app,
starts it, and opens Chrome on the right page. Keep it anywhere you like —
to put it on your Desktop, hold **⌥ Option + ⌘ Command** while dragging it
there (that leaves a shortcut), or right-click its Dock icon while it's open
and choose **Options → Keep in Dock**.

**The first time only**, macOS will refuse to open it, because the app isn't
registered with Apple (that costs a yearly developer fee and this app is
yours, not a company's). The polite workaround takes four clicks:

1. Double-click **Chat Atlas** → macOS says it "can't verify" the app. Click **Done**.
2. Open **System Settings → Privacy & Security**, scroll to the **Security** section.
3. You'll see *"Chat Atlas" was blocked…* — click **Open Anyway**.
4. Confirm **Open Anyway**, type your Mac password, and it opens. macOS
   remembers this forever; from now on it's a plain double-click.

Also one-time: the very first launch downloads the app's building blocks,
which takes a minute or two — you'll see a small notification while it works.

### Or start it by hand (always works)

Open **Terminal**, type `cd ` (with a space), drag the **chat-atlas** folder
onto the window, press Enter, then run `npm install` (first time only) and
`npm run dev`. Open **Chrome** at **http://localhost:5173**.

> **Why Chrome?** The automatic-updating feature uses a folder-watching
> ability only Chrome (and Edge) have. Other browsers work too — you just
> drag new exports in by hand.

## Getting your conversations in

1. On **claude.ai**, click your initials (bottom-left) → **Settings** →
   **Privacy** → **Export data**. Claude emails you a download link.
2. Download the zip. That's the last click you ever need to make.

The first time Chat Atlas opens, it asks to be pointed at your **Downloads**
folder. Say yes once, and every future export is noticed within about 30
seconds, unpacked, merged in (never duplicated), and announced with a little
"5 new conversations, 3 updated" message. Prefer to do it by hand? Drag the
zip anywhere onto the window, any time.

## How your library is organised

The app opens onto **the Library** — your knowledge, not your chat log:

- **Overview** — what's new since your last export, what you've pinned, and
  the latest things Claude made for you.
- **By type** — Research briefs, Email or message drafts, Plans or
  frameworks, Scripts, Documents, Code. All found and labelled automatically.
- **Companies, people & tools** — Chat Atlas reads your conversations and
  works out who and what they're about, so everything touching one company
  sits on one page. It won't be perfect: use **Rename**, **Merge into…** and
  **Hide this** on any entry to teach it — your corrections stick forever.
- **Collections** — folders you curate yourself ("Cold call playbook",
  "Acme deal"). Add anything with the **＋** button on any row, reorder
  freely.
- **Pinned** — the pin button keeps anything one click away.
- **Versions** — when Claude drafted the same email four times, you see one
  card with a small **v4** badge, not four near-identical cards. Click the
  badge to see the older drafts.

**Search** floats above everything: it covers every word either of you ever
wrote (attachments included), forgives typos, offers filters (dates, who
said it, has code / table / long-form / attachment), and clicking a result
opens the conversation at that exact message, highlighted. The **Map** and
**Timeline** tabs are still there when you want the bird's-eye view.

## Turning knowledge into documents

Every list in the Library — a type, a company page, a collection, your
pinned items — has a **Make one document** button. It combines everything
shown into a single tidy file with a cover and contents page, in your
choice of:

- **Word (.docx)** — a real Word document, one click.
- **PDF** — the app prepares a print-perfect page and opens Chrome's dialog;
  choose "Save as PDF". Two clicks.
- **Markdown (.md)** — plain text with formatting, for pasting anywhere.

Every individual item has the same three options behind its download button,
plus a copy button that grabs the full text.

## Your privacy, concretely

- The app makes **zero network requests** — no analytics, no fonts from the
  internet, nothing. Once it's running you could unplug the internet and
  nothing would change.
- Your conversations live in your browser's own built-in database
  (IndexedDB), on your disk, and nowhere else.
- The git settings for this folder refuse to ever commit zip files or
  exported conversation data, so your history can't end up in the repository.

## When something looks off

- **A company/person entry that's wrong or useless** — open it and click
  **Hide this** (or Rename / Merge). The detector is honest guesswork; your
  corrections are permanent and survive every future import.
- **"N items skipped" in the top bar** — part of an export was in a shape
  the app didn't recognise. Everything readable was kept; the link lists
  exactly what was left out and why, in plain English.
- **"Allow watching again" button** — Chrome sometimes wants a fresh
  one-click permission after a restart. One click resumes auto-updating.
- **A big export feels slow to import** — the heavy work runs in a
  background thread with a progress card; the app stays usable throughout.

## For the technically curious

Vite + React + TypeScript. Parsing, merging, search indexing (MiniSearch),
entity detection, version grouping and the similarity maths all run in a Web
Worker; storage is IndexedDB via `idb`; zips via `jszip`; Word files via
`docx` (generated fully client-side, loaded on demand); markdown via
`react-markdown`/`remark`. Data intake is a swappable adapter
(`src/adapters/`) so an official live source could be plugged in without
rewriting the app. Tests: `npm run test:e2e` (Playwright, drives the real
app end to end, including unzipping the generated .docx to verify it) and
`npm run test:launcher` (the Mac launcher's folder-resolution ladder).
The Mac app bundle follows the same pattern as the tax-tracker's launcher:
a hand-authored `Info.plist` + shell script + `.icns` built by
`npm run icons`.
