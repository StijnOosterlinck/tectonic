# Payroll Knowledge Assistant – Trust prototype (phase 1)

Hackathon demo for the SD Worx case "Find it. Understand it. Trust it."

Payroll consultants find answers in many places: official policies, old manuals, chat messages, documents for other countries. They often can't tell which source to trust. This prototype shows every source that answers a question with a **scorecard** and an **overall trust score**. The score is built from transparent rules: source type, owner, age, votes from colleagues, and hard stops such as "superseded" or "wrong country". The consultant picks a document, gets the answer from that document, and votes on whether it helped. That vote feeds back into the score for the next question on the same topic.

## How to run

- Double-click `index.html`. It works over `file://`, with no build step and no dependencies.
- Or serve the folder: `npx serve` or `python -m http.server`, then open the printed URL.

## Demo script

1. Open the app and click **Reset demo**. Question 1 shows. Cards in order: *Meal voucher policy 2026* (92, High, Recommended), *Teams message* (47, Medium), *Meal vouchers Luxembourg* (35, Low), *Payroll manual* (35, Low).
2. Click **Use this document** on *Payroll manual, benefits chapter*. The answer is €6.50, with a red "superseded" warning.
3. Click **Use this document** on *Meal voucher policy 2026*. The answer is €7.50, with no warning. Click 👍.
4. The policy now shows +13 votes and score 93.
5. Click **Next question** to go to question 2. The policy shows the badge "+1 since last question" and score 93.
6. Select the policy. The answer is €1.20.

## How scoring works

All values live in `SCORING` in `data.js`.

1. Start at 80.
2. Source type: official policy −0, manual/checklist −10, chat message −15.
3. Owner: active −0, no owner −15, owner left the company −15.
4. Age: −5 per year older than the demo year (2026), up to −20.
5. Votes (net = base votes + votes given in the demo): positive gives +1 per vote (max +15); negative gives −2 per vote.
6. Clamp to 0–100.
7. Hard stops: expired, superseded, or wrong country. Any hard stop caps the score at 35 and forces Low trust.
8. Level: ≥ 75 High, ≥ 40 Medium, otherwise Low.

Cards are sorted by final score, with ties broken by raw score. The top card is marked **Recommended**. All date checks use the fixed demo date `2026-09-30`, so the demo always looks the same.

## What is fictional

Everything. The documents, people, teams, votes and amounts are made up. The amounts are **not** real legislation. Votes are stored only in your browser (`localStorage`).

## Not built yet (phase 2)

- LLM answers
- Retrieval over real documents
- Database
- Login
- Conflict detection with expert pop-up
