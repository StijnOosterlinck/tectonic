# Build spec: Payroll Knowledge Trust prototype (phase 1)

You are building a small, static demo web app for a hackathon (SD Worx case: "Find it. Understand it. Trust it."). Build exactly what is described here. Do not add features, frameworks or dependencies beyond this spec.

## 1. What the app does

A payroll consultant gets a question. The app shows four source documents, each with a **scorecard** and an **overall trust score**. The consultant picks a document and gets the answer from that document. After using it, the consultant can upvote or downvote it. The demo runs **two questions on the same topic**, so the vote from question 1 is visible in question 2.

All data is hard-coded and fictional. There is no LLM, no API, no backend, no database, no login.

## 2. Hard constraints

- Plain **HTML, CSS and JavaScript** only. No frameworks, no build step, no npm packages, no CDN scripts, no external fonts.
- Must work by **double-clicking `index.html`** (file://). Therefore: load scripts with classic `<script src="...">` tags (no ES modules, no `fetch`).
- No network requests of any kind.
- Never insert data with `innerHTML`. Build DOM nodes with `document.createElement` and set text with `textContent` (this matters for the security audit).
- Add a Content-Security-Policy meta tag: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`. No inline scripts or inline `style` attributes; use classes.
- No secrets, keys or real personal data anywhere.

## 3. Files

```
/index.html
/styles.css
/data.js      – demo date, questions, documents, answers, scoring config
/app.js       – state, scoring, rendering, event handlers
/README.md
/.gitignore   – .DS_Store, Thumbs.db, .vscode/
/assets/      – the team logo (see §6a)
```

`index.html` loads `data.js` first, then `app.js`, at the end of `<body>`.

## 4. Data (put in `data.js` as global constants)

### 4.1 Demo date

`DEMO_DATE = "2026-09-30"` – all age and expiry checks use this date, never the real clock, so the demo always looks the same.

### 4.2 Context

Country of the question: `BE` (Belgium). Topic: `meal-vouchers`.

### 4.3 Questions

| id | Text |
|---|---|
| q1 | What is the maximum employer contribution for meal vouchers in Belgium in 2026? |
| q2 | What is the minimum employee contribution for meal vouchers in Belgium in 2026? |

### 4.4 Documents

| id | title | sourceType | team | owner | ownerStatus | year | country | validUntil | supersededBy | baseVotes |
|---|---|---|---|---|---|---|---|---|---|---|
| d1 | Meal voucher policy 2026 | official-policy | Payroll BE Legal | Sarah Janssens | active | 2026 | BE | 2026-12-31 | – | 12 |
| d2 | Teams message: meal voucher update | chat-message | Unknown | – | none | 2025 | BE | – | – | 2 |
| d3 | Payroll manual, benefits chapter | manual | Payroll Operations | Tom Peeters | left-company | 2024 | BE | – | d1 | 5 |
| d4 | Meal vouchers Luxembourg | official-policy | Payroll LU | Marc Weber | active | 2026 | LU | 2026-12-31 | – | 8 |

Each document also has a short `content` text (2–3 sentences) shown behind a "View document" toggle:

- **d1:** "From 1 January 2026, the employer contribution to meal vouchers is capped at €7.50 per voucher. The employee contributes at least €1.20 per voucher. This policy replaces all earlier internal guidance on meal vouchers."
- **d2:** "Hey all, heard the meal voucher amounts went up this year, think the employer part is €7.50 now? Employee part still about €1 I believe. Can someone from legal confirm?"
- **d3:** "Meal vouchers: the employer contribution is capped at €6.50 per voucher. The employee contributes at least €1.09 per voucher. Last reviewed March 2024."
- **d4:** "Luxembourg: the employer contributes up to €8.00 per meal voucher. The employee contributes at least €2.80 per voucher. Applies to employees working in Luxembourg only."

### 4.5 Answers (one per document per question)

| doc | q1 answer | q2 answer |
|---|---|---|
| d1 | The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026. | The employee must contribute at least €1.20 per meal voucher. |
| d2 | Probably €7.50 per voucher, but this is an informal message and it asks for confirmation from legal. | Roughly €1 per voucher, according to an unconfirmed chat message. |
| d3 | The maximum employer contribution is €6.50 per meal voucher. | The employee must contribute at least €1.09 per meal voucher. |
| d4 | In Luxembourg, the employer contributes up to €8.00 per meal voucher. | In Luxembourg, the employee contributes at least €2.80 per meal voucher. |

Show a small footer line on every screen: "Demo with fictional data. Amounts are not real legislation."

### 4.6 Scoring config (also in `data.js`, so it can be tuned)

```js
SCORING = {
  base: 80,
  sourceTypePenalty: { "official-policy": 0, "manual": 10, "checklist": 10, "chat-message": 15 },
  ownerPenalty: { "active": 0, "none": 15, "left-company": 15 },
  agePenaltyPerYear: 5,        // per year older than the DEMO_DATE year
  agePenaltyMax: 20,
  upvoteBonusPerVote: 1,       // for positive net votes
  upvoteBonusMax: 15,
  downvotePenaltyPerVote: 2,   // for negative net votes
  hardStopCap: 35,             // max score when a hard stop applies
  thresholds: { high: 75, medium: 40 } // >= high: High, >= medium: Medium, else Low
}
```

## 5. Scoring rules (implement in one pure function in `app.js`)

`scoreDocument(doc, netVotes, context)` returns `{ score, level, reasons[], hardStops[] }`:

1. Start at `base`.
2. Subtract the source-type penalty. Reason: e.g. "Informal source (chat message): −15".
3. Subtract the owner penalty. Reason: "No owner: −15" or "Owner left the company: −15".
4. Subtract the age penalty (`(demoYear − doc.year) × 5`, capped at 20). Reason: "2 years old: −10". Skip if 0.
5. Votes: if net > 0 add `min(net, 15)`; if net < 0 subtract `2 × |net|`. Reason: "13 net upvotes: +13".
6. Clamp to 0–100.
7. Hard stops (any one makes it apply): `validUntil` before DEMO_DATE → "Expired"; `supersededBy` set → "Superseded by Meal voucher policy 2026" (use the other doc's title); `country` ≠ context country → "Wrong country: LU, question is about BE". If any hard stop applies: `score = min(score, hardStopCap)` and level is forced to Low.
8. Level from thresholds: High / Medium / Low.

Expected results at first load (use these as tests):

| doc | raw score | final | level |
|---|---|---|---|
| d1 | 92 | 92 | High |
| d2 | 47 | 47 | Medium |
| d3 | 50 | 35 | Low (superseded) |
| d4 | 88 | 35 | Low (wrong country) |

After one upvote on d1: 93, High.

Sorting: by final score descending; ties by raw score descending. The first card gets a "Recommended" label.

## 6. Colours

Define as CSS variables in `:root` in `styles.css`:

```css
--brand-blue: #006DD8;    /* header, buttons, links, selected card, "Recommended" label; white text */
--brand-red: #F1002F;     /* Low trust, warnings; white text, bold */
--brand-yellow: #FFBE00;  /* Medium trust; DARK text #1A1A1A, never white */
--trust-high: #1E9E5A;    /* High trust; white text. If the team drops green, set this to var(--brand-blue) */
--text: #1A1A1A;
--muted: #5F6368;
--bg: #F7F8FA;
--card: #FFFFFF;
--border: #E0E3E8;
```

Clean, modern layout: system font stack, max content width ~960px, cards with 12px radius and a subtle border, generous spacing. Responsive: cards in a 2-column grid on desktop, 1 column below 700px.

## 6a. Logo

The team logo is already in the project folder (an image file such as `.svg`, `.png` or `.jpg`; look for a file with "logo" in its name, or the only image file in the folder).

- Move it to `/assets/` and keep its original file name and format. Do not redraw, recolour or re-encode it.
- Show it in the header, left of the app title, at a height of 32–40px, width automatic (keep the aspect ratio). Reference it with a relative path (`assets/<file name>`) so it works via file://.
- Give it meaningful `alt` text (the team or product name if visible in the logo, otherwise "Team logo").
- If the logo does not stand out on the blue header (e.g. a blue or dark logo), place it on a small white rounded background (8px padding, 8px radius) instead of changing the logo.
- If you find no logo file, or more than one candidate, stop and ask me which file to use.

## 7. Screen layout (single page)

1. **Header** (blue): logo (§6a), app title "Payroll Knowledge Assistant" + subtitle "Prototype – find it, understand it, trust it". Right side: "Reset demo" button (outlined, white).
2. **Question panel:** label "Question 1 of 2" (or 2 of 2), the question text in a read-only box styled like an input, and a chip "Country: Belgium".
3. **Sources section:** heading "Sources found (4)" and the four document cards.
4. **Answer panel:** hidden until a document is selected.
5. **Footer:** the fictional-data line.

### Document card

- Title + source type label (e.g. "Official policy", "Chat message").
- Score badge: large number (e.g. "92") + level text ("High trust"), coloured by level.
- "Recommended" label on the top card.
- Badge "+1 since last question" (or "−1 …") when the doc's votes changed during the previous question (see §8).
- Metadata list: Team, Owner (or "No owner" / "Tom Peeters – left company"), Year, Country, Valid until (or "Unknown"), Votes (net, e.g. "+12").
- Hard stops shown first, in red, with a warning icon (use a text symbol like "⚠", no icon library).
- Reasons list (small, muted): each score adjustment on its own line.
- "View document" toggle that shows/hides `content`.
- Button "Use this document".

### Answer panel

- Heading "Answer", `aria-live="polite"`.
- The answer text for the current question and selected document.
- "Based on: <title>" with its score badge.
- If the doc is Low: red warning box listing the hard stops, e.g. "Careful: this document is superseded by Meal voucher policy 2026." If Medium: yellow note "Medium trust: consider checking a stronger source."
- Vote row: "Did this help with your customer?" + 👍 and 👎 buttons. One vote per document per question: clicking the same button again removes the vote, clicking the other switches it. Show the current state (pressed button styled, `aria-pressed`).
- Votes update the card's score and the sort order immediately.
- Button "Next question" (on q1) → goes to q2. On q2 the button reads "Start over" → back to q1, keeping votes.

The consultant may select a different document at any time; the answer panel updates.

## 8. State and persistence

Keep all state in one object and re-render from it. Persist in `localStorage` (wrap every read/write in try/catch; if storage is unavailable, keep working in memory):

- `trustDemo.votes` – `{ [questionId]: { [docId]: 1 | -1 } }` – the vote a user gave per question.
- `trustDemo.questionIndex` – 0 or 1.
- `trustDemo.snapshot` – net vote delta per doc at the moment the current question started.

Net votes for a doc = `baseVotes` + sum of that doc's votes over all questions (votes count for the topic, not per question).

"+N since last question" badge: when moving to the next question, store a snapshot of the votes added during the previous question; show the badge on docs with a non-zero delta. The badge disappears when the next question starts.

"Reset demo" clears the three keys, returns to q1, and deselects everything.

## 9. README.md

Include: one-paragraph project description (the trust problem and the scorecard idea), how to run (double-click `index.html`, or `npx serve` / `python -m http.server`), the demo script (§10), how scoring works (short version of §5), what is fictional, and "Not built yet (phase 2)": LLM answers, retrieval over real documents, database, login, conflict detection with expert pop-up.

## 10. Demo script (must work end to end)

1. Open the app (after Reset demo). Question 1 shows. Cards in order: d1 (92, High, Recommended), d2 (47, Medium), d4 (35, Low), d3 (35, Low).
2. Click "Use this document" on d3 → answer €6.50 with a red "superseded" warning.
3. Click "Use this document" on d1 → answer €7.50, no warning. Click 👍.
4. d1 now shows +13 votes and score 93.
5. Click "Next question" → question 2. d1 shows the badge "+1 since last question" and score 93.
6. Select d1 → answer €1.20.

## 11. Acceptance checklist

- [ ] Opens via file:// with no console errors.
- [ ] Initial scores and order exactly match §5 and §10.
- [ ] Votes persist across page reload; Reset demo clears them.
- [ ] No `innerHTML`, no inline scripts/styles, CSP meta tag present, no network requests.
- [ ] Yellow badges use dark text; red and blue use white.
- [ ] Layout works at 375px and 1280px width.
- [ ] Keyboard: all buttons reachable and usable with Tab/Enter; visible focus style.
- [ ] Logo loads from `/assets/` via file://, is sharp, keeps its aspect ratio and has alt text.

## 12. Git

Initialise a git repository, make an initial commit with all files, and tell me the command to add the GitHub remote and push. Do not create the remote or push without asking me.
