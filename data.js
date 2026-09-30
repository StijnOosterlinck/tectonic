// Demo data. All data is fictional. Amounts are not real legislation.

// All age and expiry checks use this date, never the real clock.
const DEMO_DATE = "2026-09-30";

const CONTEXT = {
  country: "BE",
  countryName: "Belgium",
  topic: "meal-vouchers"
};

const QUESTIONS = [
  { id: "q1", text: "What is the maximum employer contribution for meal vouchers in Belgium in 2026?" },
  { id: "q2", text: "What is the minimum employee contribution for meal vouchers in Belgium in 2026?" }
];

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
    supersededBy: null,
    baseVotes: 12,
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
    supersededBy: null,
    baseVotes: 2,
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
    supersededBy: "d1",
    baseVotes: 5,
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
    supersededBy: null,
    baseVotes: 8,
    content: "Luxembourg: the employer contributes up to €8.00 per meal voucher. The employee contributes at least €2.80 per voucher. Applies to employees working in Luxembourg only."
  }
];

// ANSWERS[questionId][docId]
const ANSWERS = {
  q1: {
    d1: "The maximum employer contribution is €7.50 per meal voucher, from 1 January 2026.",
    d2: "Probably €7.50 per voucher, but this is an informal message and it asks for confirmation from legal.",
    d3: "The maximum employer contribution is €6.50 per meal voucher.",
    d4: "In Luxembourg, the employer contributes up to €8.00 per meal voucher."
  },
  q2: {
    d1: "The employee must contribute at least €1.20 per meal voucher.",
    d2: "Roughly €1 per voucher, according to an unconfirmed chat message.",
    d3: "The employee must contribute at least €1.09 per meal voucher.",
    d4: "In Luxembourg, the employee contributes at least €2.80 per meal voucher."
  }
};

const SCORING = {
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
};

const SOURCE_TYPE_LABELS = {
  "official-policy": "Official policy",
  "manual": "Manual",
  "checklist": "Checklist",
  "chat-message": "Chat message"
};

const COUNTRY_NAMES = {
  BE: "Belgium",
  LU: "Luxembourg"
};
