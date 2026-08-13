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

## Your files: the exact documents Claude made you

The app opens onto **Your files** — every PDF and Word document Claude has
made for you, newest first, showing the date *and time* Claude made it. One
**Download** button per file, and it hands back the original, byte for byte.

**The one promise this app makes:** it will only ever give you bytes it
actually holds. It never writes a document itself and passes it off as
Claude's. If the real file isn't on this Mac, the row says so and points you
back to the chat where you can download it.

Some honest background. Claude's data export contains the *words* of your
conversations, never the actual PDF or Word file. Those bytes exist in two
places only: Anthropic's servers, and your own Mac once you've clicked
download. Fetching them from Anthropic would need your Claude login, which
this app must never hold. So:

- **From now on it's automatic.** Point Chat Atlas at the folder your Claude
  downloads land in — or several folders; it looks inside sub-folders too —
  and every document Claude made that arrives there is saved permanently.
  Delete the download, empty the bin: your copy stays.
- **It knows Claude's work when it sees it.** Every file Claude makes
  carries its own title, description and the exact instant it was created.
  Chat Atlas reads that, so files sort by when Claude actually made them,
  show Claude's own title rather than a mangled filename, and get matched to
  the right conversation — even when the filename gives nothing away (an
  `export-8837.docx` still finds its chat, by the minute it was made).
  Anything that isn't Claude's — your own Word documents, a bank statement
  in the same folder — is left alone, silently.
- **The page tells you how fresh it is.** A line at the top says which date
  your chats are known up to, and **Bring in my newest chats** walks you
  through the one-minute export that catches it up (new chats can only reach
  the app through Claude's export — fetching them directly would need your
  Claude login, which this app must never hold).
- **Files you haven't downloaded yet are still listed**, grouped by chat,
  with a **Get it from Claude** button that opens that exact conversation.
  Claude's own "Download all" there collects every file from that chat at
  once, and they appear here by themselves. A running count shows how far
  through the backlog you are.
- **Already have files scattered about?** Drag a whole folder onto the
  window, use **Add files I already have**, or **Scan a folder once**.
- **Auto-save folder**: pick a folder once and copies of everything here are
  written into it as real files too.

Elsewhere in the app, **Combine into a new document** does something
different and says so: it builds a *brand-new* file out of what Claude wrote
in your chats. Those always download with a `chat-atlas-` prefix so they can
never be confused with the originals.

## How your library is organised

The app opens onto **the Library** — your knowledge, not your chat log:

- **Your files** — the file archive described above; where the app opens.
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

## Building something new out of your chats

Separate from Your files, every list in the Library — a type, a company
page, a collection, your pinned items — has a **Combine into a new
document** button. It assembles what Claude *wrote in the chats* into one
tidy file with a cover and contents page, as **Word** or **PDF**.

This is a new document, not a copy of anything Claude gave you, so its
filename always begins `chat-atlas-`. Individual items offer the same two
formats, plus a copy button for the full text.

## Updating the app: one click

When a new version of Chat Atlas exists, an orange **Update to v…** button
appears in the top bar. Click it, wait a minute, and the app refreshes
itself — no downloading ZIPs, no replacing folders. Clicking the Chat Atlas
logo checks on demand and tells you either way.

How it works, honestly: new versions live in a small **public** repository
(github.com/jasecutlerMT/chat-atlas) that contains only this app's code —
never your conversations, which don't touch GitHub at all. When you click
Update (and once at startup, to know whether to show the button), the app's
little local server asks that repository for the latest code. Nothing about
you is sent; it's a plain download, like visiting a web page.

## Your privacy, concretely

- The app page makes **zero network requests** — no analytics, no fonts
  from the internet, nothing. Your conversations live only on your machine.
  The one deliberate exception, described above: the local server contacts
  GitHub to *fetch app updates* — code comes down, nothing goes up.
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
`npm run test:launcher` (the Mac launcher’s folder-resolution ladder) and `npm run test:no-fabrication` (a tripwire that fails if the app ever regains the ability to invent a document).
The Mac app bundle follows the same pattern as the tax-tracker's launcher:
a hand-authored `Info.plist` + shell script + `.icns` built by
`npm run icons`.
