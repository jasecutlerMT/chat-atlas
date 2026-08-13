// Builds synthetic Claude.ai export zips for the e2e tests, at test time,
// into a gitignored tmp folder. Nothing here is real data, and the repo's
// gitignore refuses zips, so fixtures can never be committed.
import JSZip from 'jszip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TMP = join(HERE, '.tmp');

let mid = 0;
const msgId = () => `mmmmmmmm-0000-0000-0000-${String(++mid).padStart(12, '0')}`;
const convId = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, '0')}`;

function msg(sender, text, at) {
  return {
    uuid: msgId(),
    text,
    content: [{ type: 'text', text }],
    sender,
    created_at: at,
    updated_at: at,
    attachments: [],
    files: [],
  };
}

function conv(n, name, created, updated, messages) {
  return { uuid: convId(n), name, created_at: created, updated_at: updated, chat_messages: messages };
}

/** Body text used inside the synthetic Claude documents the specs build. */
export const BODY_ACME =
  'Acme Logistics moves freight across Victoria and New South Wales, and their operations desk still books carriers by hand.';

const BRIEF = `# Research brief: Acme Logistics

## Overview
Acme Logistics moves freight across Victoria and New South Wales. The company employs about 300 people and runs a fleet of 120 trucks between Melbourne and Sydney every week of the year.

## Product and buyers
Their operations team still books carriers in spreadsheets. The buyer for our platform would be the Head of Operations, who reports to the founder directly and controls the tooling budget.

## Competitors
They compete with Rondo Freight on price and with larger national carriers on coverage. Neither rival offers automated customs paperwork, which is our opening.

## Key numbers
Revenue grew roughly thirty percent last year. Staff churn is low. The operations desk handles four hundred bookings a week.`;

const EMAIL_BODY = `Subject: Quick question about your carrier bookings

Hi there,

I noticed your operations team manages carrier bookings by hand. Our platform cuts that admin by about six hours a week, and freight teams like yours usually see the payback inside a month.

Would a fifteen minute walkthrough on Thursday afternoon be worth your time?

Best regards,
Jason`;

const EMAIL_V2 = `Sure! Here's a tighter version:

Subject: Quick question about your carrier bookings

Hi there,

Your operations team books carriers by hand. Our platform cuts that admin by six hours a week, with payback inside a month for freight teams like yours.

Worth fifteen minutes on Thursday afternoon?

Best regards,
Jason`;

const EMAIL_V3 = `Here's the punchier cut:

Subject: Quick question about your carrier bookings

Hi there,

You book carriers by hand. We cut that admin by six hours a week — payback inside a month for freight teams.

Fifteen minutes Thursday afternoon?

Best regards,
Jason`;

const PLAN = `# 30-60-90 day plan

## Phase 1: Days 1-30
1. Shadow ten discovery calls and note every objection heard on each call.
2. Master the CRM hygiene rules for the pipeline.
3. Book three meetings from warm inbound leads.

## Phase 2: Days 31-60
1. Launch two personalised outbound sequences.
2. Hit eighty percent of ramp quota for the quarter.

## Phase 3: Days 61-90
1. Reach full quota and document the playbook for the vertical.`;

const CODE_MSG = 'Here\'s a small script that renames your interview notes consistently:\n\n```python\nimport re\nfrom pathlib import Path\n\nNOTES = Path.home() / "Documents" / "notes"\n\nfor f in NOTES.glob("*.md"):\n    slug = re.sub(r"[^a-z0-9]+", "-", f.stem.lower()).strip("-")\n    f.rename(f.with_name(slug + ".md"))\n    print("renamed", f.name)\n```\n\nRun it once and every file gets a tidy name.';

const SCRIPT_MSG = `# Cold call script

You: Hi, this is Jason. You do not know me and this is a cold call. Twenty seconds?

Them: Go on then.

You: Freight teams tell us carrier admin eats six hours a week. Familiar?

Them: Painfully.

You: Then Thursday at two might be the best fifteen minutes of your week. Fair?

Them: Send me something first.

You: Done. If the one-pager lands, I pencil Thursday. Deal?`;

const LONG_DOC = `The received wisdom says enterprise sales is where careers are made, but the data tells a different story for someone at an early stage. Mid-market deals close in weeks rather than quarters, which means a new rep gets ten times the learning cycles in a single year. Every discovery call and every lost deal compounds into pattern recognition that enterprise reps take years to accumulate. There is also a structural argument worth taking seriously. Mid-market teams are small enough that a rep who shows initiative gets pulled into strategy conversations that would sit three layers away at a large vendor, and the distance between the floor and revenue leadership is two desks rather than two org charts. Finally there is the tooling angle to weigh. Mid-market stacks are modern because the companies themselves are young, so the instruments you learn are the ones the industry is standardising on rather than a decade-old system customised beyond recognition. The trade-off is real: smaller logos on the resume and smaller absolute deal sizes. But early on you should optimise for repetitions rather than logos, because the logos come later and they come faster to people who learned the craft where the cycle time is short.`;

/**
 * Builds a real .docx carrying the metadata Chat Atlas fingerprints.
 * `claudeMade: false` simulates the same file re-saved in Word: an
 * Application stamp, a named last-saver, a high revision and Word's own extra
 * parts — all of which must flip the verdict.
 */
export async function makeClaudeDocx({
  title,
  description = 'a document made for testing',
  creator = 'Jason',
  created = '2026-06-28T09:05:30.000Z',
  modified,
  body = 'This is the body of the document.',
  claudeMade = true,
}) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body
      .split('\n')
      .map((line) => `<w:p><w:r><w:t>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  );
  const mod = modified ?? (claudeMade ? created : '2026-07-02T11:00:00.000Z');
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${
      title ? `<dc:title>${title}</dc:title>` : ''
    }<dc:creator>${claudeMade ? creator : 'Jason'}</dc:creator>${
      description ? `<dc:description>${description}</dc:description>` : ''
    }<cp:lastModifiedBy>${claudeMade ? 'Un-named' : 'Jason'}</cp:lastModifiedBy><cp:revision>${
      claudeMade ? 1 : 14
    }</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${mod}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    claudeMade
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion></Properties>`,
  );
  if (!claudeMade) {
    zip.file('word/theme/theme1.xml', '<theme/>');
    zip.file('word/webSettings.xml', '<webSettings/>');
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A minimal PDF whose Info dictionary is byte-scannable. */
export function makePdfBytes({ title, created = 'D:20260628090532Z', producer = 'LibreOffice 24.2' }) {
  const body = `%PDF-1.7
1 0 obj
<</Type/Catalog/Pages 2 0 R>>
endobj
2 0 obj
<</Type/Pages/Kids[3 0 R]/Count 1>>
endobj
3 0 obj
<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>
endobj
4 0 obj
<</Title(${title})/Producer(${producer})/Creator(Writer)/CreationDate(${created})>>
endobj
trailer
<</Root 1 0 R/Info 4 0 R>>
%%EOF
`;
  return Buffer.from(body, 'latin1');
}

export async function makeFixtures() {
  mkdirSync(TMP, { recursive: true });
  const conversations = [
    conv(1, 'Acme Logistics research brief', '2026-05-03T09:00:00.000000Z', '2026-05-03T10:00:00.000000Z', [
      msg('human', 'I have a discovery call with Acme Logistics next week. Put together a research brief.', '2026-05-03T09:00:00.000000Z'),
      msg('assistant', BRIEF, '2026-05-03T09:02:00.000000Z'),
    ]),
    conv(2, 'Acme Logistics interview prep', '2026-05-10T08:00:00.000000Z', '2026-05-10T08:30:00.000000Z', [
      msg('human', 'Give me smart questions to ask Acme Logistics on the call.', '2026-05-10T08:00:00.000000Z'),
      msg(
        'assistant',
        '# Questions for the call\n\n## Step 1: Warm up\n1. Ask how the operations desk splits the booking workload today.\n2. Ask what happens when a carrier cancels late on a Friday.\n\n## Step 2: Dig in\n1. Ask who owns the tooling budget at Acme Logistics and when it resets.\n2. Ask what would make this quarter a win for their team.',
        '2026-05-10T08:05:00.000000Z',
      ),
    ]),
    conv(3, 'Follow-up email to Jane Smith', '2026-05-20T13:00:00.000000Z', '2026-05-20T13:20:00.000000Z', [
      msg('human', 'I spoke with Jane Smith yesterday about the role. Draft a short follow-up email to Jane Smith.', '2026-05-20T13:00:00.000000Z'),
      msg(
        'assistant',
        'Subject: Great speaking yesterday\n\nHi Jane,\n\nThanks for making the time yesterday. I loved hearing how the team is rebuilding its outbound motion around industry verticals, and the quota story maps closely to what I did last year.\n\nHappy to share references whenever useful.\n\nBest regards,\nJason',
        '2026-05-20T13:05:00.000000Z',
      ),
    ]),
    conv(4, 'Cold email drafts for Salesforce outreach', '2026-06-01T10:00:00.000000Z', '2026-06-01T11:00:00.000000Z', [
      msg('human', 'Draft a cold email for operations managers. We integrate with Salesforce.', '2026-06-01T10:00:00.000000Z'),
      msg('assistant', EMAIL_BODY, '2026-06-01T10:05:00.000000Z'),
      msg('human', 'Shorter please.', '2026-06-01T10:10:00.000000Z'),
      msg('assistant', EMAIL_V2, '2026-06-01T10:12:00.000000Z'),
      msg('human', 'Punchier.', '2026-06-01T10:20:00.000000Z'),
      msg('assistant', EMAIL_V3, '2026-06-01T10:22:00.000000Z'),
    ]),
    conv(5, 'Second thoughts on that Salesforce email', '2026-06-02T09:00:00.000000Z', '2026-06-02T09:30:00.000000Z', [
      msg('human', 'Show me that punchy Salesforce cold email again, I want to tweak it.', '2026-06-02T09:00:00.000000Z'),
      msg('assistant', EMAIL_V3, '2026-06-02T09:02:00.000000Z'),
    ]),
    conv(6, '30-60-90 day plan', '2026-06-10T08:00:00.000000Z', '2026-06-10T08:40:00.000000Z', [
      msg('human', 'Build me a 30-60-90 day plan for the new role.', '2026-06-10T08:00:00.000000Z'),
      msg('assistant', PLAN, '2026-06-10T08:05:00.000000Z'),
    ]),
    conv(7, 'Rename my interview notes', '2026-06-15T11:00:00.000000Z', '2026-06-15T11:20:00.000000Z', [
      msg('human', 'My notes folder is a mess. Script to rename the files?', '2026-06-15T11:00:00.000000Z'),
      msg('assistant', CODE_MSG, '2026-06-15T11:02:00.000000Z'),
    ]),
    conv(8, 'Cold call script practice', '2026-06-20T19:00:00.000000Z', '2026-06-20T19:30:00.000000Z', [
      msg('human', 'Write me an honest cold call script.', '2026-06-20T19:00:00.000000Z'),
      msg('assistant', SCRIPT_MSG, '2026-06-20T19:03:00.000000Z'),
    ]),
    conv(9, 'Untitled conversation', '2026-06-21T09:00:00.000000Z', '2026-06-21T09:01:00.000000Z', [
      msg('human', 'hello', '2026-06-21T09:00:00.000000Z'),
      msg('assistant', 'Hello! How can I help today?', '2026-06-21T09:00:30.000000Z'),
    ]),
    conv(10, 'Is mid-market the right move', '2026-06-25T21:00:00.000000Z', '2026-06-25T21:30:00.000000Z', [
      msg('human', 'Honest take: enterprise or mid-market for my next role?', '2026-06-25T21:00:00.000000Z'),
      msg('assistant', LONG_DOC, '2026-06-25T21:05:00.000000Z'),
    ]),
    conv(11, 'Turn the Acme brief into a file', '2026-06-26T10:00:00.000000Z', '2026-06-26T10:30:00.000000Z', [
      msg('human', 'Please turn the Acme Logistics research brief into a docx file I can send to my manager.', '2026-06-26T10:00:00.000000Z'),
      msg('assistant', BRIEF, '2026-06-26T10:02:00.000000Z'),
      msg('human', 'Perfect. Give me the file.', '2026-06-26T10:10:00.000000Z'),
      (() => {
        const m = msg(
          'assistant',
          "I've created your file: acme-logistics-brief.docx — click the download card above this message to save it.",
          '2026-06-26T10:12:00.000000Z',
        );
        m.files = [{ file_name: 'acme-logistics-brief.docx' }];
        return m;
      })(),
    ]),
    // A tool-heavy conversation like real Claude usage: text blocks mixed
    // with tool_use / tool_result / thinking machinery that must never
    // surface as "[tool use content]" placeholders anywhere.
    conv(13, "Understanding how I'll visualise my chat history", '2026-06-27T09:00:00.000000Z', '2026-06-27T09:40:00.000000Z', [
      msg('human', "Help me understand the best way to visualise my chat history. I'll need a proper tool for it.", '2026-06-27T09:00:00.000000Z'),
      {
        uuid: msgId(),
        text: '',
        content: [
          { type: 'thinking', thinking: 'hidden reasoning that must never surface' },
          {
            type: 'text',
            text: '# Visualising your chat history\n\nA good visualisation needs three layers working together, and the order you build them in matters more than most people expect. The first layer is a timeline, because human memory is anchored in time: people rarely remember the exact words of a conversation, but they almost always remember roughly when it happened, what season it was, or what else was going on in their life at the time. A horizontal axis of dots, one per conversation, exploits that anchoring directly and costs almost nothing to learn.\n\nThe second layer is grouping by topic, so related conversations sit near each other instead of being scattered across months. Grouping is where most tools go wrong, because they group by statistical similarity and then label the groups with statistical words that mean nothing to the person reading them. The labels must come from the world the reader lives in: the names of companies, people, projects and tools. If the group label is not a word the reader would have said out loud, the group is decoration rather than navigation.\n\nThe third layer is search, because the first two layers only ever narrow things down — the last step of every real retrieval is finding the exact sentence, and no map or grouping replaces typing three words and jumping straight to the line. Search has to tolerate typos, cover every word ever written including the contents of attachments, and land the reader on the precise message with the match highlighted, not just open the right conversation and leave them scrolling.\n\nBuild the timeline first, then the grouping, then the search, and resist the temptation to merge the three layers into one clever view that does none of the three jobs properly. Every successful history tool keeps the layers separate and lets each one hand off to the next: time narrows to a neighbourhood, topic narrows to a shelf, and search lands on the page.',
          },
          { type: 'tool_use', name: 'artifacts', input: { command: 'create' } },
          { type: 'tool_result', content: 'ok' },
          { type: 'text', text: 'The working version is in the panel above — try zooming the timeline.' },
        ],
        sender: 'assistant',
        created_at: '2026-06-27T09:05:00.000000Z',
        updated_at: '2026-06-27T09:05:00.000000Z',
        attachments: [],
        files: [],
      },
    ]),
    // A file delivered like Claude's real download cards: the chat announces
    // the files but the export carries no filename — the downloaded file
    // ("SydneyTechTargetList100.docx") must still match by meaning.
    conv(14, 'Sydney tech target list', '2026-06-28T09:00:00.000000Z', '2026-06-28T09:30:00.000000Z', [
      msg('human', 'Build me a target list of Sydney tech companies. Give it to me as a PDF and a Word document.', '2026-06-28T09:00:00.000000Z'),
      msg(
        'assistant',
        '# Sydney tech target list\n\n## Tier 1\n1. The companies with ANZ sales teams above twenty seats belong here, because their SDR motion is established and the hiring bar is documented.\n2. Prioritise the ones whose careers pages mention outbound explicitly.\n\n## Tier 2\n1. Series B and later with a first sales hire in the last year.\n2. Watch these quarterly; their needs change fast.\n\n## How to use this list\nWork ten names a week, top down, and record every touch in one place so the follow-up rhythm never depends on memory.',
        '2026-06-28T09:05:00.000000Z',
      ),
      msg('assistant', 'Your files are ready to download above.', '2026-06-28T09:06:00.000000Z'),
    ]),
    // The same document announced in two separate messages — one file, and it
    // must appear as ONE row in the "not on this Mac yet" list.
    conv(15, 'Docusign deep dive for the team', '2026-06-27T10:00:00.000000Z', '2026-06-27T10:30:00.000000Z', [
      msg('human', 'Turn the Docusign deep dive into a Word document file I can share with the team.', '2026-06-27T10:00:00.000000Z'),
      (() => {
        const m = msg('assistant', "I've created docusign-deep-dive.docx — the full deep dive, ready to download above.", '2026-06-27T10:05:00.000000Z');
        m.files = [{ file_name: 'docusign-deep-dive.docx' }];
        return m;
      })(),
      msg('human', 'The download stopped halfway. Can you give me the file again?', '2026-06-27T10:10:00.000000Z'),
      (() => {
        const m = msg('assistant', 'Here is docusign-deep-dive.docx again — the same document, ready to download.', '2026-06-27T10:12:00.000000Z');
        m.files = [{ file_name: 'docusign-deep-dive.docx' }];
        return m;
      })(),
    ]),
    // A chat whose only "files" are markdown and CSV. Jason only ever wants
    // Word documents and PDFs on the Your files screen, so this chat must
    // leave no trace there — not even a nameless "Claude made a file" row.
    conv(16, 'Openclaw skill notes', '2026-06-24T15:00:00.000000Z', '2026-06-24T15:20:00.000000Z', [
      msg('human', 'Package the openclaw skill up for me — save it as a document file if that works best.', '2026-06-24T15:00:00.000000Z'),
      (() => {
        const m = msg(
          'assistant',
          "I've created SKILL.md — a markdown file with everything the skill needs, plus data.csv holding the numbers.",
          '2026-06-24T15:05:00.000000Z',
        );
        m.files = [{ file_name: 'SKILL.md' }, { file_name: 'data.csv' }];
        return m;
      })(),
    ]),
    // Deliberately corrupted: no uuid — must be skipped with a readable reason.
    { name: 'Corrupted conversation', created_at: '2026-06-26T00:00:00.000000Z', updated_at: '2026-06-26T00:00:00.000000Z', chat_messages: [] },
  ];

  await writeZip('sample.zip', conversations);

  // Second export: one new conversation and one updated, both dated in the
  // future relative to the test run so the "What's new" view can see them.
  const future = new Date(Date.now() + 6 * 3600_000).toISOString().replace('Z', '000Z');
  const conversations2 = JSON.parse(JSON.stringify(conversations)).filter((c) => c.uuid);
  const c6 = conversations2.find((c) => c.uuid === convId(6));
  c6.chat_messages.push(
    msg('human', 'Update the plan: I start Monday.', future),
    msg(
      'assistant',
      '# Week one addendum\n\n## Step 1: Land well\n1. Meet every account executive for fifteen minutes each.\n2. Set up the CRM views before Friday.\n3. Book the first internal shadowing block for the discovery calls.',
      future,
    ),
  );
  c6.updated_at = future;
  conversations2.push(
    conv(12, 'Northwind Software offer negotiation', future, future, [
      msg('human', 'Northwind Software offered 72k base. Help me negotiate the offer.', future),
      msg(
        'assistant',
        '# Negotiation plan\n\n## Step 1: Anchor with enthusiasm\nOpen warmly, then name the number you want with the band as your evidence.\n\n## Step 2: Hold the silence\nAfter the number, stop talking and let the silence negotiate.\n\n## Step 3: Trade, do not cave\nIf they hold firm, trade for a written review clause tied to quota instead of caving on the base.',
        future,
      ),
      msg('human', 'Great. Can I have that as a PDF file to print?', future),
      (() => {
        const m = msg('assistant', "I've created northwind-negotiation-plan.pdf — use the download card above to save it.", future);
        m.files = [{ file_name: 'northwind-negotiation-plan.pdf' }];
        return m;
      })(),
    ]),
  );
  await writeZip('sample2.zip', conversations2);

  // Big export for the performance spec: 250 generated conversations.
  const topics = ['freight', 'pipeline', 'quota', 'renewal', 'onboarding', 'pricing', 'demo', 'handover', 'forecast', 'territory'];
  const big = [];
  for (let i = 0; i < 250; i++) {
    const t = topics[i % topics.length];
    const at = `2026-0${1 + (i % 6)}-1${i % 9}T09:00:00.000000Z`;
    big.push(
      conv(1000 + i, `Working session ${i} about ${t}`, at, at, [
        msg('human', `Help me think through the ${t} problem number ${i}.`, at),
        msg(
          'assistant',
          `# Notes on ${t} ${i}\n\n## Step 1\n1. The ${t} process needs a clear owner and a weekly rhythm to stay honest.\n2. Write down the numbers for ${t} before and after each change so the impact is visible.\n\n## Step 2\n1. Review the ${t} playbook with the team every second week and prune what stopped working.`,
          at,
        ),
      ]),
    );
  }
  await writeZip('big.zip', big);
}

async function writeZip(name, conversations) {
  const zip = new JSZip();
  zip.file('conversations.json', JSON.stringify(conversations));
  zip.file('projects.json', JSON.stringify([]));
  zip.file('users.json', JSON.stringify([{ uuid: 'u', full_name: 'Test User' }]));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(join(TMP, name), buf);
}
