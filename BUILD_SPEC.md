# Build spec: Payroll Knowledge Trust prototype (phase 1)

You are building a small, static demo web app for a hackathon (SD Worx case: "Find it. Understand it. Trust it."). Build exactly what is described here. Do not add features, frameworks or dependencies beyond this spec.

## 1. What the app does

A payroll consultant gets a question. The app shows the relevant source documents, each with a **scorecard** and an **overall trust score**. The consultant picks a document and gets the answer from that document, and can upvote or downvote it.

When two sources **contradict** each other or are **duplicates**, a **conflict pop-up** appears with three options: *I am expert* (resolve now), *Send message to expert*, or *Skip*. Experts resolve conflicts from the pop-up or from their inbox; the outcome changes the scorecards.

The demo runs **two questions on the same topic**, so votes and expert decisions from question 1 are visible in question 2.

All data is hard-coded and fictional. There is no LLM, no API, no backend, no database and no real login. Phase 1 only leaves out the LLM and the database; all interaction logic is real.

## 2. Hard constraints

- Plain **HTML, CSS and JavaScript** only. No frameworks, no build step, no npm packages, no CDN scripts, no external fonts.
- Must work by **double-clicking `index.html`** (file://). Therefore: load scripts with classic `<script src="...">` tags (no ES modules, no `fetch`).
- No network requests of any kind.
- Never insert data with `innerHTML`. Build DOM nodes with `document.createElement` and set text with `textContent` (this matters for the security audit).
- Add a Content-Security-Policy meta tag: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`. No inline scripts or inline `style` attributes; use classes.
- No secrets, keys or real personal data anywhere.
- Use the native `<dialog>` element (`showModal()`) for the pop-up, so focus handling and Escape work without extra code.

## 3. Files

```
/index.html
/styles.css
/data.js      – demo date, users, questions, documents, answers, conflicts, scoring config
/app.js       – state, scoring, conflict logic, rendering, event handlers
/README.md
/.gitignore   – .DS_Store, Thumbs.db, .vscode/
/assets/      – the team logo (see §7)
```

`index.html` loads `data.js` first, then `app.js`, at the end of `<body>`.

## 4. Data (put in `data.js` as global constants)

### 4.1 Demo date and context

- `DEMO_DATE = "2026-09-30"` – all age and expiry checks and all "resolved on" dates use this date, never the real clock.
- Country of the questions: `BE` (Belgium). Topic: `meal-vouchers`.

### 4.2 Users (demo role switch, no real login)

| id | name | role | expertForTeams |
|---|---|---|---|
| u1 | Lotte Maes | consultant | – |
| u2 | Sarah Janssens | expert | Payroll BE Legal, HR Academy |

The app starts as Lotte.

### 4.3 Questions

| id | Text |
|---|---|
| q1 | What is the maximum employer contribution for meal vouchers in Belgium in 2026? |
| q2 | What is the minimum employee contribution for meal vouchers in Belgium in 2026? |

Both questions show the same documents (same topic).

### 4.4 Documents

| id | title | sourceType | team | owner | ownerStatus | year | country | validUntil | baseVotes |
|---|---|---|---|---|---|---|---|---|---|
| d1 | Meal voucher policy 2026 | official-policy | Payroll BE Legal | Sarah Janssens | active | 2026 | BE | 2026-12-31 | 12 |
| d2 | Teams message: meal voucher update | chat-message | Unknown | – | none | 2025 | BE | – | 2 |
| d3 | Payroll manual, benefits chapter | manual | Payroll Operations | Tom Peeters | left-company | 2024 | BE | – | 7 |
| d4 | Meal vouchers Luxembourg | official-policy | Payroll LU | Marc Weber | active | 2026 | LU | 2026-12-31 | 8 |
| d5 | Onboarding slide: meal vouchers | training-slide | HR Academy | An Claes | active | 2026 | BE | – | 3 |

Each document has a status that can change at runtime: `active` (default), `superseded` (lost a contradiction), `archived` (removed duplicate).

Each document also has a short `content` text (2–3 sentences) shown behind a "View document" toggle:

- **d1:** "From 1 January 2026, the employer contribution to meal vouchers is capped at €7.50 per voucher. The employee contributes at least €1.20 per voucher. This policy replaces all earlier internal guidance on meal vouchers."
- **d2:** "Hey all, heard the meal voucher amounts went up this year, think the employer part is €7.50 now? Employee part still about €1 I believe. Can someone from legal confirm?"
- **d3:** "Meal vouchers: the employer contribution is capped at €6.50 per voucher. The employee contributes at least €1.09 per voucher. Last reviewed March 2024."
- **d4:** "Luxembourg: the employer contributes up to €8.00 per meal voucher. The employee contributes at least €2.80 per voucher. Applies to employees working in Luxembourg only."
- **d5:** "From 1 January 2026, the employer contribution to meal vouchers is capped at €7.50 per voucher. The employee contributes at least €1.20 per voucher. (Copied from the 2026 meal voucher policy for new-joiner training.)"

### 4.5 Answers (one per document per question)

| doc | q1 answer | q2 answer |
|---|---|---|
| d1 | The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026. | The employee must contribute at least €1.20 per meal voucher. |
| d2 | Probably €7.50 per voucher, but this is an informal message and it asks for confirmation from legal. | Roughly €1 per voucher, according to an unconfirmed chat message. |
| d3 | The maximum employer contribution is €6.50 per meal voucher. | The employee must contribute at least €1.09 per meal voucher. |
| d4 | In Luxembourg, the employer contributes up to €8.00 per meal voucher. | In Luxembourg, the employee contributes at least €2.80 per meal voucher. |
| d5 | The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026. | The employee must contribute at least €1.20 per meal voucher. |

Show a small footer line on every screen: "Demo with fictional data. Amounts are not real legislation."

### 4.6 Conflicts (pre-detected, hard-coded)

| id | type | docA | docB | explanation |
|---|---|---|---|---|
| c1 | contradiction | d1 | d3 | The 2026 policy caps the employer contribution at €7.50; the 2024 manual says €6.50. |
| c2 | duplicate | d1 | d5 | The onboarding slide copies the 2026 policy text almost word for word. |

Owning teams of a conflict = the teams of its two documents. A user may resolve a conflict only if their `expertForTeams` includes at least one of those teams (Sarah qualifies for both; Lotte for none).

Runtime conflict state: `status` = `open` | `sent` | `resolved`, plus `winner`, `resolvedBy`, `resolvedAt` when resolved.

### 4.7 Scoring config (also in `data.js`, so it can be tuned)

```js
SCORING = {
  base: 80,
  sourceTypePenalty: { "official-policy": 0, "manual": 10, "checklist": 10, "training-slide": 10, "chat-message": 15 },
  ownerPenalty: { "active": 0, "none": 15, "left-company": 15 },
  agePenaltyPerYear: 5,        // per year older than the DEMO_DATE year
  agePenaltyMax: 20,
  upvoteBonusPerVote: 1,       // for positive net votes
  upvoteBonusMax: 15,
  downvotePenaltyPerVote: 2,   // for negative net votes
  openConflictPenalty: 10,     // once per document, if it is in ANY open or sent conflict
  expertConfirmedBonus: 5,     // once per document, if it WON at least one resolved conflict
  hardStopCap: 35,             // max score when a hard stop applies
  thresholds: { high: 75, medium: 40 } // >= high: High, >= medium: Medium, else Low
}
```

## 5. Scoring rules (implement in one pure function in `app.js`)

`scoreDocument(doc, netVotes, conflicts, context)` returns `{ raw, score, level, reasons[], hardStops[] }`:

1. Start at `base`.
2. Subtract the source-type penalty. Reason, e.g. "Informal source (chat message): −15".
3. Subtract the owner penalty. Reason: "No owner: −15" or "Owner left the company: −15".
4. Subtract the age penalty (`(demoYear − doc.year) × 5`, capped at 20). Reason: "2 years old: −10". Skip if 0.
5. Votes: if net > 0 add `min(net, 15)`; if net < 0 subtract `2 × |net|`. Reason: "13 net upvotes: +13".
6. If the doc is in any conflict with status `open` or `sent`: subtract 10 once. Reason: "Open conflict with <other title>: −10".
7. If the doc won any resolved conflict: add 5 once. Reason: "Confirmed by Sarah Janssens: +5".
8. Clamp to 0–100. This is `raw`.
9. Hard stops: `validUntil` before DEMO_DATE → "Expired"; status `superseded` → "Superseded by <winner title>, decided by <expert> on <date>"; `country` ≠ context country → "Wrong country: LU, question is about BE". If any hard stop applies: `score = min(raw, hardStopCap)` and level is forced to Low. Otherwise `score = raw`.
10. Level from thresholds: High / Medium / Low.

Archived documents are not scored and not shown as cards (see §8).

**Expected results (use these as tests):**

| Moment | d1 | d5 | d2 | d3 | d4 |
|---|---|---|---|---|---|
| Start (q1, nothing done) | 82 High | 63 Medium | 47 Medium | 42 Medium | 35 Low (wrong country) |
| After Lotte upvotes d1 | 83 High | 63 | 47 | 42 | 35 |
| After Sarah resolves c1 (d1 correct) | 88 High | 63 | 47 | 35 Low (superseded) | 35 |
| After Sarah resolves c2 (keep d1, archive d5) | 98 High | archived, hidden | 47 | 35 | 35 |

Sorting: by `score` descending; ties by `raw` descending. The first card gets a "Recommended" label.

## 6. Colours

Define as CSS variables in `:root` in `styles.css`:

```css
--brand-blue: #006DD8;    /* header, buttons, links, selected card, "Recommended" label; white text */
--brand-red: #F1002F;     /* Low trust, warnings; white text, bold */
--brand-yellow: #FFBE00;  /* Medium trust, open-conflict badges; DARK text #1A1A1A, never white */
--trust-high: #1E9E5A;    /* High trust; white text. If the team drops green, set this to var(--brand-blue) */
--text: #1A1A1A;
--muted: #5F6368;
--bg: #F7F8FA;
--card: #FFFFFF;
--border: #E0E3E8;
```

Clean, modern layout: system font stack, max content width ~1040px, cards with 12px radius and a subtle border, generous spacing. Responsive: cards in a 2-column grid on desktop, 1 column below 700px.

## 7. Logo

The team logo is already in the project folder (an image file such as `.svg`, `.png` or `.jpg`; look for a file with "logo" in its name, or the only image file in the folder).

- Move it to `/assets/` and keep its original file name and format. Do not redraw, recolour or re-encode it.
- Show it in the header, left of the app title, at a height of 32–40px, width automatic. Reference it with a relative path (`assets/<file name>`) so it works via file://.
- Give it meaningful `alt` text (the team or product name if visible in the logo, otherwise "Team logo").
- If the logo does not stand out on the blue header, place it on a small white rounded background (8px padding, 8px radius) instead of changing the logo.
- If you find no logo file, or more than one candidate, stop and ask me which file to use.

## 8. Screens and components (single page)

### 8.1 Header (blue)

- Left: logo, app title "Payroll Knowledge Assistant", subtitle "Prototype – find it, understand it, trust it".
- Right:
  - **Role switch:** a `<select>` labelled "Demo role:" with "Lotte Maes – Consultant" and "Sarah Janssens – Expert (Payroll BE Legal, HR Academy)". Show a small note "Demo only – not real authentication".
  - **Inbox button** (only visible when the current user is an expert): "Conflict inbox (n)", where n = conflicts with status `sent` that this expert may resolve.
  - **Reset demo** button (outlined, white).

### 8.2 Question panel

Label "Question 1 of 2" (or 2 of 2), the question text in a read-only box styled like an input, and a chip "Country: Belgium".

### 8.3 Sources section

Heading "Sources found (n)", then one card per non-archived document. If any document is archived, show a muted line under the cards: "1 archived duplicate hidden: Onboarding slide: meal vouchers (archived by Sarah Janssens)".

**Document card:**

- Title + source type label (e.g. "Official policy", "Chat message", "Training slide").
- Score badge: large number + level text ("High trust"), coloured by level.
- "Recommended" label on the top card.
- Badge "+1 since last question" (or "−1 …") when the doc's votes changed during the previous question (§9).
- Conflict badges (yellow): "⚠ Contradicts: <other title>" or "⚠ Duplicate of: <other title>" for each open conflict; "⏳ Waiting for expert" when status is `sent`.
- Green badge "✓ Confirmed by Sarah Janssens" on a document that won a resolved conflict.
- Metadata list: Team, Owner (or "No owner" / "Tom Peeters – left company"), Year, Country, Valid until (or "Unknown"), Votes (net, e.g. "+12").
- Hard stops shown first, in red, with "⚠" (no icon library).
- Reasons list (small, muted): each score adjustment on its own line.
- "View document" toggle that shows/hides `content`.
- Button "Use this document".

### 8.4 Conflict pop-up (`<dialog>`)

**When it opens:** whenever a question is shown (on load, after "Next question", after a role switch, after reset), if any conflict among the shown documents has status `open` and has not been skipped for this question. With several conflicts, show them one at a time: "Conflict 1 of 2". Conflicts with status `sent` or `resolved` never open the pop-up.

**Content:**

- Title: "Contradicting sources found" or "Duplicate sources found".
- The explanation from §4.6.
- The two documents side by side: title, score badge, team, year, and the relevant sentence (the doc's `content`).
- Three buttons:
  1. **"I am expert – resolve now"**: enabled only if the current user may resolve this conflict (§4.6). If not, show it disabled with the text below it: "Only experts of Payroll BE Legal or Payroll Operations can resolve this." Clicking it switches the dialog to the resolve view (§8.5).
  2. **"Send message to expert"**: sets status to `sent`, closes this conflict, and shows a short confirmation toast: "Sent to Sarah Janssens (Payroll BE Legal)". Pick the first expert whose teams match.
  3. **"Skip"**: status stays `open`, remember the skip for this question only, move on. The answer still works; cards keep the open-conflict badge.

### 8.5 Resolve view (inside the pop-up, and from the inbox)

- Contradiction: two buttons "<docA title> is correct" and "<docB title> is correct". The loser becomes `superseded`.
- Duplicate: two buttons "Keep <docA title>, archive the other" and "Keep <docB title>, archive the other". The loser becomes `archived`.
- A "Cancel" button returns to the previous view without changes.
- On resolve: set status `resolved`, `winner`, `resolvedBy` = current user, `resolvedAt` = DEMO_DATE; close the conflict; re-score and re-render; show toast "Conflict resolved".
- **Always re-check permission in the resolve function itself**, not only by disabling the button. If the current user may not resolve it, do nothing and show an error toast. (Client-side only in this demo; state this in the README.)

### 8.6 Conflict inbox (expert only)

A panel or dialog listing conflicts with status `sent` that the current expert may resolve: type, both titles, explanation, and a "Resolve" button that opens the resolve view (§8.5). Empty state: "No conflicts waiting. Nice work."

### 8.7 Answer panel

Hidden until a document is selected.

- Heading "Answer", `aria-live="polite"`.
- The answer text for the current question and selected document.
- "Based on: <title>" with its score badge.
- Low: red warning box listing the hard stops (e.g. "Careful: this document is superseded by Meal voucher policy 2026, decided by Sarah Janssens on 30 Sep 2026."). Medium: yellow note "Medium trust: consider checking a stronger source." Open or sent conflict on this doc: yellow note "This document is in an unresolved conflict with <other title>."
- Vote row: "Did this help with your customer?" + 👍 and 👎. One vote per user per document per question: clicking the same button again removes the vote, clicking the other switches it. Show the pressed state (`aria-pressed`). Votes update the card's score and sort order immediately.
- Button "Next question" (on q1) → q2. On q2 the button reads "Start over" → back to q1, keeping all votes and conflict decisions.

The user may select a different document at any time. If the selected document gets archived, clear the selection.

## 9. State and persistence

Keep all state in one object and re-render everything from it. Persist in `localStorage` (wrap every read/write in try/catch; if storage is unavailable, keep working in memory):

- `trustDemo.votes` – `{ [userId]: { [questionId]: { [docId]: 1 | -1 } } }`
- `trustDemo.questionIndex` – 0 or 1
- `trustDemo.snapshot` – vote delta per doc added during the previous question (for the "+N since last question" badge)
- `trustDemo.conflicts` – runtime state per conflict (§4.6)
- `trustDemo.docStatus` – runtime status per document
- `trustDemo.skipped` – `{ [questionId]: [conflictIds] }`
- `trustDemo.userId` – current demo user

Net votes for a doc = `baseVotes` + sum of all users' votes on that doc over all questions (votes count for the topic, not per question).

"Reset demo" clears all keys, returns to q1 as Lotte, deselects everything and re-runs the pop-up check.

## 10. Demo script (must work end to end)

1. After Reset demo: question 1 as Lotte. Cards: d1 82, d5 63, d2 47, d3 42, d4 35 (§5 table).
2. Pop-up "Conflict 1 of 2" (d1 vs d3, contradiction). "I am expert" is disabled for Lotte. Click **Send message to expert** → toast.
3. Pop-up "Conflict 2 of 2" (d1 vs d5, duplicate). Click **Skip**.
4. Select d3 → answer €6.50 with the yellow unresolved-conflict note. Select d1 → answer €7.50. Click 👍 → d1 shows +13 votes and 83.
5. Switch role to Sarah. No pop-up for c1 (status `sent`); c2 was skipped for q1, so no pop-up either. Open **Conflict inbox (1)** → resolve c1: "Meal voucher policy 2026 is correct". d3 turns red (35, superseded, decided by Sarah); d1 goes to 88 with "Confirmed by Sarah Janssens".
6. Click **Next question** → question 2 as Sarah. d1 shows "+1 since last question". Pop-up for c2 opens → **I am expert – resolve now** → "Keep Meal voucher policy 2026, archive the other". d5 disappears (archived line shown); d1 goes to 98.
7. Switch back to Lotte, select d1 → answer €1.20, High trust, confirmed by Sarah.

## 11. README.md

Include: a one-paragraph project description (the trust problem, scorecards and expert conflict resolution), how to run (double-click `index.html`, or `npx serve` / `python -m http.server`), the demo script (§10), how scoring works (short version of §5), what is fictional, a note that the role switch and permission checks are client-side demo logic only (real authentication and server-side authorization come in phase 2), and "Not built yet (phase 2)": LLM answers, retrieval over real documents, automatic conflict detection, database, real login.

## 12. Acceptance checklist

- [ ] Opens via file:// with no console errors.
- [ ] Scores and card order match the §5 table at every moment of the §10 demo script.
- [ ] Pop-up opens only for `open`, non-skipped conflicts; "I am expert" is disabled for Lotte and enabled for Sarah.
- [ ] The resolve function refuses non-experts even if called directly (e.g. from the console).
- [ ] Votes, conflict decisions and document statuses persist across page reload; Reset demo clears everything.
- [ ] No `innerHTML`, no inline scripts/styles, CSP meta tag present, no network requests.
- [ ] Yellow badges use dark text; red and blue use white.
- [ ] Dialog works with keyboard (Tab, Enter); Escape behaves exactly like Skip.
- [ ] Layout works at 375px and 1280px width.
- [ ] Logo loads from `/assets/` via file://, is sharp, keeps its aspect ratio and has alt text.

## 13. Git

Initialise a git repository, make an initial commit with all files, and tell me the command to add the GitHub remote and push. Do not create the remote or push without asking me.
