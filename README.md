# Payroll Knowledge Assistant – Trust prototype (phase 1)

Project repository for Tectonic Hackathon.

Hackathon demo for the SD Worx case "Find it. Understand it. Trust it."

Payroll consultants find answers in many places: official policies, old manuals, chat messages, training slides, documents for other countries. They often can't tell which source to trust, and sources sometimes contradict or duplicate each other. This prototype shows every source that answers a question with a **scorecard** and an **overall trust score**. The score is built from transparent rules: source type, owner, age, colleague votes, open conflicts, expert confirmation, and hard stops such as "superseded" or "wrong country". When two sources **contradict** each other or are **duplicates**, a conflict pop-up lets the consultant resolve it (if they are an expert for the owning team), send it to an expert, or skip it. The expert's decision immediately changes the scorecards: the winner is confirmed, and the loser is superseded or archived.

## How to run

- Double-click `index.html`. It works over `file://`, with no build step and no dependencies.
- Or serve the folder: `npx serve` or `python -m http.server`, then open the printed URL.

The UI is a chat. The demo question is already in the chat bar; click **Send** to see the documents. Hover a document (or use the ⓘ button) to see its scorecard, and click it to get the answer. The conflict check runs as soon as the documents are shown.

## Demo script

1. Click **Reset demo**. You are Lotte (consultant) on question 1; click **Send**. Documents in order: *Meal voucher policy 2026* 80, *Onboarding slide* 64, *Teams message* 47, *Payroll manual* 41, *Meal vouchers Luxembourg* 35.
2. Pop-up "Conflict 1 of 2" (policy vs manual, contradiction). "I am expert" is disabled for Lotte. Click **Send message to expert**; a toast confirms it was sent to Sarah Janssens.
3. Pop-up "Conflict 2 of 2" (policy vs onboarding slide, duplicate). Click **Skip**.
4. Click the manual: the answer is €6.50, with a yellow "unresolved conflict" note. Click the policy: the answer is €7.50. Click 👍: the vote is recorded ("Thanks – counted from the next question"), and the score does not change yet.
5. Switch **Demo role** to Sarah. No pop-up appears: c1 was sent and c2 was skipped for this question. Open **Conflict inbox (1)**, click **Resolve**, then "Meal voucher policy 2026 is correct". The manual turns red (35, superseded, decided by Sarah). The policy goes to 85 and shows "Confirmed by Sarah Janssens" in its scorecard.
6. Click **Next question**, then **Send**. Lotte's vote now counts: the policy's scorecard shows "1 new helpful vote since last question" and "13 of 14 found it helpful". The score stays 85, because one extra vote barely moves a helpful rate. The pop-up for the duplicate opens: click **I am expert – resolve now**, then "Keep Meal voucher policy 2026, archive the other". The onboarding slide disappears (an "archived duplicate hidden" line is shown), and the policy goes to 95.
7. Switch back to Lotte and click the policy: the answer is €1.20, with High trust and "Confirmed by Sarah Janssens".

## How scoring works

All values live in `SCORING` in `data.js`.

1. Start at 80.
2. Source type: official policy −0; manual, checklist or training slide −10; chat message −15.
3. Owner: active −0, no owner −15, owner left the company −15.
4. Age: −5 per year older than the demo year (2026), up to −20.
5. Colleague feedback as a **helpful rate**, not a vote count: 100% helpful gives +12, 50% gives 0, 0% gives −12. The effect is scaled down while there are fewer than 10 votes. Votes count from the **next question** on, not immediately.
6. Open or sent conflict: −10 (once per document).
7. Won a resolved conflict: +5, "Confirmed by …" (once per document).
8. Clamp to 0–100; this is the raw score.
9. Hard stops: expired, superseded (lost a contradiction), or wrong country. Any hard stop caps the score at 35 and forces Low trust.
10. Level: ≥ 75 High, ≥ 40 Medium, otherwise Low.

Documents are sorted by final score, with ties broken by raw score. The top one is marked **Recommended**. Archived documents are not scored or shown. All date checks and "resolved on" dates use the fixed demo date `2026-09-30`, so the demo always looks the same.

| Moment | Policy | Slide | Teams | Manual | LU |
|---|---|---|---|---|---|
| Start | 80 | 64 | 47 | 41 | 35 |
| After Lotte upvotes the policy | 80 (vote pending) | 64 | 47 | 41 | 35 |
| After Sarah resolves c1 | 85 | 64 | 47 | 35 (superseded) | 35 |
| Question 2 (vote now counted: 13 of 14 helpful) | 85 | 64 | 47 | 35 | 35 |
| After Sarah resolves c2 | 95 | archived | 47 | 35 | 35 |

## Roles and permissions (demo only)

The **Demo role** switch is not authentication: anyone can switch between Lotte (consultant) and Sarah (expert for Payroll BE Legal and HR Academy). The permission check, "only an expert of one of the conflict's owning teams may resolve it", is enforced inside the resolve function itself, not only by disabling buttons. Calling `resolveConflict("c1", "d1")` from the browser console as Lotte is refused. This is still **client-side demo logic only**: someone with dev tools can edit `localStorage`. Real authentication and server-side authorization come in phase 2.

## What is fictional

Everything. The documents, people, teams, votes, conflicts and amounts are made up. The amounts are **not** real legislation. State is stored only in your browser (`localStorage`, keys starting with `trustDemo.`); **Reset demo** clears it.

## Not built yet (phase 2)

- LLM answers
- Retrieval over real documents
- Automatic conflict detection
- Database
- Real login (authentication and server-side authorization)
