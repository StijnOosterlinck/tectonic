// Demo data. All data is fictional. Amounts are not real legislation.

// All age and expiry checks and all "resolved on" dates use this date, never the real clock.
const DEMO_DATE = "2026-09-30";

const CONTEXT = {
  country: "BE",
  countryName: "Belgium",
  topic: "meal-vouchers"
};

// Demo role switch – not real authentication.
const USERS = [
  { id: "u1", name: "Lotte Maes", role: "consultant", expertForTeams: [] },
  { id: "u2", name: "Sarah Janssens", role: "expert", expertForTeams: ["Payroll BE Legal", "HR Academy"] }
];

const DEFAULT_USER_ID = "u1";

const QUESTIONS = [
  { id: "q1", text: "What is the maximum employer contribution for meal vouchers in Belgium in 2026?" },
  { id: "q2", text: "What is the minimum employee contribution for meal vouchers in Belgium in 2026?" }
];

// Static document data. Runtime status (active / superseded / archived) lives in app state.
const DOCUMENTS = [
  {
    id: "d1",
    title: "Meal voucher policy 2026",
    sourceType: "official-policy",
    team: "Payroll BE Legal",
    owner: "Sarah Janssens",
    ownerStatus: "active",
    year: 2026,
    country: "BE",
    validUntil: "2026-12-31",
    baseFeedback: { helpful: 12, notHelpful: 1 },
    content: "From 1 January 2026, the employer contribution to meal vouchers is capped at €7.50 per voucher. The employee contributes at least €1.20 per voucher. This policy replaces all earlier internal guidance on meal vouchers."
  },
  {
    id: "d2",
    title: "Teams message: meal voucher update",
    sourceType: "chat-message",
    team: "Unknown",
    owner: null,
    ownerStatus: "none",
    year: 2025,
    country: "BE",
    validUntil: null,
    baseFeedback: { helpful: 3, notHelpful: 1 },
    content: "Hey all, heard the meal voucher amounts went up this year, think the employer part is €7.50 now? Employee part still about €1 I believe. Can someone from legal confirm?"
  },
  {
    id: "d3",
    title: "Payroll manual, benefits chapter",
    sourceType: "manual",
    team: "Payroll Operations",
    owner: "Tom Peeters",
    ownerStatus: "left-company",
    year: 2024,
    country: "BE",
    validUntil: null,
    baseFeedback: { helpful: 7, notHelpful: 2 },
    content: "Meal vouchers: the employer contribution is capped at €6.50 per voucher. The employee contributes at least €1.09 per voucher. Last reviewed March 2024."
  },
  {
    id: "d4",
    title: "Meal vouchers Luxembourg",
    sourceType: "official-policy",
    team: "Payroll LU",
    owner: "Marc Weber",
    ownerStatus: "active",
    year: 2026,
    country: "LU",
    validUntil: "2026-12-31",
    baseFeedback: { helpful: 8, notHelpful: 1 },
    content: "Luxembourg: the employer contributes up to €8.00 per meal voucher. The employee contributes at least €2.80 per voucher. Applies to employees working in Luxembourg only."
  },
  {
    id: "d5",
    title: "Onboarding slide: meal vouchers",
    sourceType: "training-slide",
    team: "HR Academy",
    owner: "An Claes",
    ownerStatus: "active",
    year: 2026,
    country: "BE",
    validUntil: null,
    baseFeedback: { helpful: 3, notHelpful: 0 },
    content: "From 1 January 2026, the employer contribution to meal vouchers is capped at €7.50 per voucher. The employee contributes at least €1.20 per voucher. (Copied from the 2026 meal voucher policy for new-joiner training.)"
  }
];

// ANSWERS[questionId][docId]
const ANSWERS = {
  q1: {
    d1: "The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026.",
    d2: "Probably €7.50 per voucher, but this is an informal message and it asks for confirmation from legal.",
    d3: "The maximum employer contribution is €6.50 per meal voucher.",
    d4: "In Luxembourg, the employer contributes up to €8.00 per meal voucher.",
    d5: "The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026."
  },
  q2: {
    d1: "The employee must contribute at least €1.20 per meal voucher.",
    d2: "Roughly €1 per voucher, according to an unconfirmed chat message.",
    d3: "The employee must contribute at least €1.09 per meal voucher.",
    d4: "In Luxembourg, the employee contributes at least €2.80 per meal voucher.",
    d5: "The employee must contribute at least €1.20 per meal voucher."
  }
};

// Pre-detected conflicts. Runtime state (status, winner, resolvedBy, resolvedAt) lives in app state.
const CONFLICTS = [
  {
    id: "c1",
    type: "contradiction",
    docA: "d1",
    docB: "d3",
    explanation: "The 2026 policy caps the employer contribution at €7.50; the 2024 manual says €6.50."
  },
  {
    id: "c2",
    type: "duplicate",
    docA: "d1",
    docB: "d5",
    explanation: "The onboarding slide copies the 2026 policy text almost word for word."
  }
];

const SCORING = {
  base: 80,
  sourceTypePenalty: { "official-policy": 0, "manual": 10, "checklist": 10, "training-slide": 10, "chat-message": 15 },
  ownerPenalty: { "active": 0, "none": 15, "left-company": 15 },
  agePenaltyPerYear: 5,        // per year older than the DEMO_DATE year
  agePenaltyMax: 20,
  // Colleague feedback counts as a helpful RATE, not a vote count: 100% helpful -> +max, 50% -> 0,
  // 0% -> -max. The effect grows with the number of votes until fullConfidenceVotes is reached.
  helpfulRateMaxBonus: 12,
  helpfulRateFullConfidenceVotes: 10,
  openConflictPenalty: 10,     // once per document, if it is in ANY open or sent conflict
  expertConfirmedBonus: 5,     // once per document, if it WON at least one resolved conflict
  hardStopCap: 35,             // max score when a hard stop applies
  thresholds: { high: 75, medium: 40 } // >= high: High, >= medium: Medium, else Low
};

const SOURCE_TYPE_LABELS = {
  "official-policy": "Official policy",
  "manual": "Manual",
  "checklist": "Checklist",
  "training-slide": "Training slide",
  "chat-message": "Chat message"
};

const COUNTRY_NAMES = {
  BE: "Belgium",
  LU: "Luxembourg"
};
