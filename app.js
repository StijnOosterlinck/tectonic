// Payroll Knowledge Assistant – state, scoring, rendering, event handlers.
// Data comes from data.js (loaded first). DOM is built with createElement/textContent only.

(function () {
  "use strict";

  var STORAGE_KEYS = {
    votes: "trustDemo.votes",
    questionIndex: "trustDemo.questionIndex",
    snapshot: "trustDemo.snapshot"
  };

  // ---------- Scoring (pure) ----------

  function findDoc(id) {
    for (var i = 0; i < DOCUMENTS.length; i++) {
      if (DOCUMENTS[i].id === id) return DOCUMENTS[i];
    }
    return null;
  }

  function formatDelta(n) {
    if (n > 0) return "+" + n;
    if (n < 0) return "−" + Math.abs(n);
    return "0";
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function scoreDocument(doc, netVotes, context) {
    var cfg = SCORING;
    var reasons = [];
    var hardStops = [];
    var score = cfg.base;
    reasons.push("Base score: " + cfg.base);

    var typePenalty = cfg.sourceTypePenalty[doc.sourceType] || 0;
    if (typePenalty > 0) {
      var typeLabel = (SOURCE_TYPE_LABELS[doc.sourceType] || doc.sourceType).toLowerCase();
      var kind = doc.sourceType === "chat-message" ? "Informal source" : "Secondary source";
      reasons.push(kind + " (" + typeLabel + "): " + formatDelta(-typePenalty));
      score -= typePenalty;
    }

    var ownerPenalty = cfg.ownerPenalty[doc.ownerStatus] || 0;
    if (ownerPenalty > 0) {
      var ownerText = doc.ownerStatus === "left-company" ? "Owner left the company" : "No owner";
      reasons.push(ownerText + ": " + formatDelta(-ownerPenalty));
      score -= ownerPenalty;
    }

    var demoYear = parseInt(context.demoDate.slice(0, 4), 10);
    var ageYears = Math.max(0, demoYear - doc.year);
    var agePenalty = Math.min(ageYears * cfg.agePenaltyPerYear, cfg.agePenaltyMax);
    if (agePenalty > 0) {
      reasons.push(plural(ageYears, "year") + " old: " + formatDelta(-agePenalty));
      score -= agePenalty;
    }

    if (netVotes > 0) {
      var bonus = Math.min(netVotes * cfg.upvoteBonusPerVote, cfg.upvoteBonusMax);
      reasons.push(plural(netVotes, "net upvote") + ": " + formatDelta(bonus));
      score += bonus;
    } else if (netVotes < 0) {
      var penalty = Math.abs(netVotes) * cfg.downvotePenaltyPerVote;
      reasons.push(plural(Math.abs(netVotes), "net downvote") + ": " + formatDelta(-penalty));
      score -= penalty;
    }

    score = Math.max(0, Math.min(100, score));
    var rawScore = score;

    // Hard stops. ISO dates compare correctly as strings.
    if (doc.validUntil && doc.validUntil < context.demoDate) {
      hardStops.push({ label: "Expired", warning: "this document expired on " + doc.validUntil + "." });
    }
    if (doc.supersededBy) {
      var newer = findDoc(doc.supersededBy);
      var newerTitle = newer ? newer.title : doc.supersededBy;
      hardStops.push({
        label: "Superseded by " + newerTitle,
        warning: "this document is superseded by " + newerTitle + "."
      });
    }
    if (doc.country !== context.country) {
      hardStops.push({
        label: "Wrong country: " + doc.country + ", question is about " + context.country,
        warning: "this document is about " + (COUNTRY_NAMES[doc.country] || doc.country) +
          ", the question is about " + (COUNTRY_NAMES[context.country] || context.country) + "."
      });
    }

    var level;
    if (hardStops.length > 0) {
      score = Math.min(score, cfg.hardStopCap);
      level = "Low";
    } else if (score >= cfg.thresholds.high) {
      level = "High";
    } else if (score >= cfg.thresholds.medium) {
      level = "Medium";
    } else {
      level = "Low";
    }

    return { score: score, rawScore: rawScore, level: level, reasons: reasons, hardStops: hardStops };
  }

  // ---------- Storage ----------

  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      var value = JSON.parse(raw);
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Storage unavailable: keep working in memory.
    }
  }

  function removeKey(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      // ignore
    }
  }

  // ---------- State ----------

  var state = {
    questionIndex: 0,
    votes: {},          // { [questionId]: { [docId]: 1 | -1 } }
    snapshot: {},       // { [docId]: net vote delta during the previous question }
    selectedDocId: null,
    expanded: {}        // { [docId]: true } – "View document" open
  };

  function loadState() {
    var qi = load(STORAGE_KEYS.questionIndex, 0);
    state.questionIndex = qi === 1 ? 1 : 0;
    var votes = load(STORAGE_KEYS.votes, {});
    state.votes = typeof votes === "object" ? votes : {};
    var snap = load(STORAGE_KEYS.snapshot, {});
    state.snapshot = typeof snap === "object" ? snap : {};
  }

  function persist() {
    save(STORAGE_KEYS.votes, state.votes);
    save(STORAGE_KEYS.questionIndex, state.questionIndex);
    save(STORAGE_KEYS.snapshot, state.snapshot);
  }

  function currentQuestion() {
    return QUESTIONS[state.questionIndex];
  }

  function netVotesFor(doc) {
    var total = doc.baseVotes;
    for (var qid in state.votes) {
      if (Object.prototype.hasOwnProperty.call(state.votes, qid)) {
        var v = state.votes[qid] && state.votes[qid][doc.id];
        if (v === 1 || v === -1) total += v;
      }
    }
    return total;
  }

  function userVote(docId) {
    var q = state.votes[currentQuestion().id];
    return q ? q[docId] || 0 : 0;
  }

  var scoringContext = { country: CONTEXT.country, demoDate: DEMO_DATE };

  function rankedDocs() {
    var list = DOCUMENTS.map(function (doc) {
      var net = netVotesFor(doc);
      return { doc: doc, net: net, result: scoreDocument(doc, net, scoringContext) };
    });
    list.sort(function (a, b) {
      if (b.result.score !== a.result.score) return b.result.score - a.result.score;
      return b.result.rawScore - a.result.rawScore;
    });
    return list;
  }

  // ---------- Actions ----------

  function selectDoc(docId) {
    state.selectedDocId = docId;
    render();
    var panel = document.getElementById("answer-panel");
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function toggleContent(docId) {
    state.expanded[docId] = !state.expanded[docId];
    render();
  }

  function vote(docId, value) {
    var qid = currentQuestion().id;
    if (!state.votes[qid]) state.votes[qid] = {};
    if (state.votes[qid][docId] === value) {
      delete state.votes[qid][docId];
    } else {
      state.votes[qid][docId] = value;
    }
    persist();
    render();
  }

  function goToNextQuestion() {
    // Snapshot the votes added during the question that is ending.
    var prevVotes = state.votes[currentQuestion().id] || {};
    var snap = {};
    DOCUMENTS.forEach(function (doc) {
      var v = prevVotes[doc.id];
      if (v === 1 || v === -1) snap[doc.id] = v;
    });
    state.snapshot = snap;
    state.questionIndex = state.questionIndex === 0 ? 1 : 0;
    state.selectedDocId = null;
    state.expanded = {};
    persist();
    render();
    var heading = document.getElementById("question-label");
    if (heading) heading.focus();
  }

  function resetDemo() {
    removeKey(STORAGE_KEYS.votes);
    removeKey(STORAGE_KEYS.questionIndex);
    removeKey(STORAGE_KEYS.snapshot);
    state.questionIndex = 0;
    state.votes = {};
    state.snapshot = {};
    state.selectedDocId = null;
    state.expanded = {};
    render();
  }

  // ---------- Rendering helpers ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(text, className, focusKey, onClick) {
    var b = el("button", className, text);
    b.type = "button";
    if (focusKey) b.setAttribute("data-focus-key", focusKey);
    b.addEventListener("click", onClick);
    return b;
  }

  function levelClass(level) {
    return "level-" + level.toLowerCase();
  }

  function scoreBadge(result, small) {
    var badge = el("div", "score-badge " + levelClass(result.level) + (small ? " score-badge-small" : ""));
    badge.appendChild(el("span", "score-number", String(result.score)));
    badge.appendChild(el("span", "score-level", result.level + " trust"));
    return badge;
  }

  function ownerText(doc) {
    if (doc.ownerStatus === "none" || !doc.owner) return "No owner";
    if (doc.ownerStatus === "left-company") return doc.owner + " – left company";
    return doc.owner;
  }

  function metaRow(dl, label, value) {
    dl.appendChild(el("dt", null, label));
    dl.appendChild(el("dd", null, value));
  }

  function renderCard(item, isTop) {
    var doc = item.doc;
    var result = item.result;
    var selected = state.selectedDocId === doc.id;

    var card = el("article", "card" + (selected ? " card-selected" : ""));
    card.setAttribute("aria-label", doc.title);

    var top = el("div", "card-top");
    var titleWrap = el("div", "card-title-wrap");
    var labels = el("div", "card-labels");
    if (isTop) labels.appendChild(el("span", "label label-recommended", "Recommended"));
    var delta = state.snapshot[doc.id];
    if (delta) {
      labels.appendChild(el("span", "label label-delta", formatDelta(delta) + " since last question"));
    }
    if (labels.childNodes.length) titleWrap.appendChild(labels);
    titleWrap.appendChild(el("h3", "card-title", doc.title));
    titleWrap.appendChild(el("span", "source-type", SOURCE_TYPE_LABELS[doc.sourceType] || doc.sourceType));
    top.appendChild(titleWrap);
    top.appendChild(scoreBadge(result, false));
    card.appendChild(top);

    if (result.hardStops.length) {
      var stops = el("ul", "hard-stops");
      result.hardStops.forEach(function (hs) {
        var li = el("li", null);
        li.appendChild(el("span", "warn-icon", "⚠"));
        li.appendChild(document.createTextNode(" " + hs.label));
        stops.appendChild(li);
      });
      card.appendChild(stops);
    }

    var dl = el("dl", "meta");
    metaRow(dl, "Team", doc.team);
    metaRow(dl, "Owner", ownerText(doc));
    metaRow(dl, "Year", String(doc.year));
    metaRow(dl, "Country", doc.country);
    metaRow(dl, "Valid until", doc.validUntil || "Unknown");
    metaRow(dl, "Votes", formatDelta(item.net));
    card.appendChild(dl);

    var reasons = el("ul", "reasons");
    result.reasons.forEach(function (r) {
      reasons.appendChild(el("li", null, r));
    });
    card.appendChild(reasons);

    var expanded = !!state.expanded[doc.id];
    var contentId = "content-" + doc.id;
    var toggle = button(expanded ? "Hide document" : "View document", "btn-link", "toggle-" + doc.id, function () {
      toggleContent(doc.id);
    });
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-controls", contentId);
    var content = el("blockquote", "doc-content", doc.content);
    content.id = contentId;
    content.hidden = !expanded;

    var actions = el("div", "card-actions");
    actions.appendChild(toggle);
    var use = button("Use this document", "btn btn-primary", "use-" + doc.id, function () {
      selectDoc(doc.id);
    });
    use.setAttribute("aria-pressed", selected ? "true" : "false");
    actions.appendChild(use);
    card.appendChild(content);
    card.appendChild(actions);

    return card;
  }

  function renderAnswer(ranked) {
    var panel = document.getElementById("answer-panel");
    var body = document.getElementById("answer-body");
    body.textContent = "";

    var item = null;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].doc.id === state.selectedDocId) item = ranked[i];
    }
    if (!item) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    var q = currentQuestion();
    body.appendChild(el("p", "answer-text", ANSWERS[q.id][item.doc.id]));

    var based = el("div", "based-on");
    based.appendChild(el("span", null, "Based on: " + item.doc.title));
    based.appendChild(scoreBadge(item.result, true));
    body.appendChild(based);

    if (item.result.level === "Low") {
      var warn = el("div", "notice notice-low");
      warn.setAttribute("role", "alert");
      if (item.result.hardStops.length) {
        item.result.hardStops.forEach(function (hs) {
          warn.appendChild(el("p", null, "⚠ Careful: " + hs.warning));
        });
      } else {
        warn.appendChild(el("p", null, "⚠ Careful: this document has low trust."));
      }
      body.appendChild(warn);
    } else if (item.result.level === "Medium") {
      body.appendChild(el("div", "notice notice-medium", "Medium trust: consider checking a stronger source."));
    }

    var voteRow = el("div", "vote-row");
    voteRow.appendChild(el("span", "vote-question", "Did this help with your customer?"));
    var current = userVote(item.doc.id);
    var up = button("👍", "btn btn-vote" + (current === 1 ? " is-pressed" : ""), "vote-up", function () {
      vote(item.doc.id, 1);
    });
    up.setAttribute("aria-pressed", current === 1 ? "true" : "false");
    up.setAttribute("aria-label", "Yes, this helped (upvote)");
    var down = button("👎", "btn btn-vote" + (current === -1 ? " is-pressed" : ""), "vote-down", function () {
      vote(item.doc.id, -1);
    });
    down.setAttribute("aria-pressed", current === -1 ? "true" : "false");
    down.setAttribute("aria-label", "No, this did not help (downvote)");
    voteRow.appendChild(up);
    voteRow.appendChild(down);
    body.appendChild(voteRow);

    var isLast = state.questionIndex === QUESTIONS.length - 1;
    var next = button(isLast ? "Start over" : "Next question", "btn btn-primary", "next", goToNextQuestion);
    var nextRow = el("div", "next-row");
    nextRow.appendChild(next);
    body.appendChild(nextRow);
  }

  function render() {
    // Remember which control had focus so keyboard users keep their place after re-render.
    var active = document.activeElement;
    var focusKey = active && active.getAttribute ? active.getAttribute("data-focus-key") : null;

    var q = currentQuestion();
    document.getElementById("question-label").textContent =
      "Question " + (state.questionIndex + 1) + " of " + QUESTIONS.length;
    document.getElementById("question-text").textContent = q.text;
    document.getElementById("country-chip").textContent = "Country: " + CONTEXT.countryName;

    var ranked = rankedDocs();
    document.getElementById("sources-heading").textContent = "Sources found (" + ranked.length + ")";
    var list = document.getElementById("cards");
    list.textContent = "";
    ranked.forEach(function (item, i) {
      list.appendChild(renderCard(item, i === 0));
    });

    renderAnswer(ranked);

    if (focusKey) {
      var target = document.querySelector('[data-focus-key="' + focusKey + '"]');
      if (target) target.focus();
    }
  }

  // ---------- Init ----------

  document.getElementById("reset-btn").addEventListener("click", resetDemo);
  loadState();
  render();

  // Exposed for console testing only.
  window.scoreDocument = scoreDocument;
})();
