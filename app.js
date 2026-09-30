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
    sent: false,        // current question sent in the chat
    history: [],        // finished exchanges shown in the chat: { question, answer, docTitle }
    selectedDocId: null,
    openCard: null,     // docId whose scorecard is pinned open
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

  function scrollToBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }

  function send() {
    if (state.sent) return;
    state.sent = true;
    state.selectedDocId = null;
    state.openCard = null;
    render();
    var first = document.querySelector("[data-focus-key^='use-']");
    if (first) first.focus({ preventScroll: true });
    scrollToBottom();
  }

  function selectDoc(docId) {
    state.selectedDocId = docId;
    state.openCard = null;
    render();
    scrollToBottom();
  }

  function toggleCard(docId) {
    state.openCard = state.openCard === docId ? null : docId;
    render();
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
    var isLast = state.questionIndex === QUESTIONS.length - 1;

    // Keep the finished exchange visible in the chat (Start over clears it).
    if (isLast) {
      state.history = [];
    } else {
      var doc = findDoc(state.selectedDocId);
      state.history.push({
        question: currentQuestion().text,
        answer: doc ? ANSWERS[currentQuestion().id][doc.id] : "",
        docTitle: doc ? doc.title : ""
      });
    }

    // Snapshot the votes added during the question that is ending.
    var prevVotes = state.votes[currentQuestion().id] || {};
    var snap = {};
    DOCUMENTS.forEach(function (d) {
      var v = prevVotes[d.id];
      if (v === 1 || v === -1) snap[d.id] = v;
    });
    state.snapshot = snap;
    state.questionIndex = isLast ? 0 : state.questionIndex + 1;
    state.sent = false;
    state.selectedDocId = null;
    state.openCard = null;
    state.expanded = {};
    persist();
    render();
    document.getElementById("send-btn").focus({ preventScroll: true });
    scrollToBottom();
  }

  function resetDemo() {
    removeKey(STORAGE_KEYS.votes);
    removeKey(STORAGE_KEYS.questionIndex);
    removeKey(STORAGE_KEYS.snapshot);
    state.questionIndex = 0;
    state.votes = {};
    state.snapshot = {};
    state.sent = false;
    state.history = [];
    state.selectedDocId = null;
    state.openCard = null;
    state.expanded = {};
    render();
    window.scrollTo(0, 0);
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

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    }
    return node;
  }

  // Circular trust ring: an SVG arc filled to the score (pathLength 100 = percent).
  function scoreRing(result, docId, size) {
    var ring = el("span", "ring ring-" + size + " " + levelClass(result.level));
    ring.setAttribute("data-doc", docId);
    ring.setAttribute("data-score", String(result.score));
    var svg = svgEl("svg", { viewBox: "0 0 36 36", "aria-hidden": "true", focusable: "false" });
    var circle = { cx: 18, cy: 18, r: 15.5, pathLength: 100, transform: "rotate(-90 18 18)" };
    svg.appendChild(svgEl("circle", Object.assign({ "class": "ring-track" }, circle)));
    svg.appendChild(svgEl("circle", Object.assign({
      "class": "ring-value",
      "stroke-dasharray": result.score + " 100"
    }, circle)));
    ring.appendChild(svg);
    ring.appendChild(el("span", "ring-number", String(result.score)));
    return ring;
  }

  function trustPill(result) {
    return el("span", "trust-pill " + levelClass(result.level), result.level + " trust");
  }

  // Scores shown in the previous render, so a changed score can count up/down.
  var shownScores = {};
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function animateScoreChanges() {
    var rings = document.querySelectorAll(".ring[data-doc]");
    var next = {};
    Array.prototype.forEach.call(rings, function (ring) {
      var docId = ring.getAttribute("data-doc");
      var to = parseInt(ring.getAttribute("data-score"), 10);
      var from = shownScores[docId];
      next[docId] = to;
      if (from === undefined || from === to || reduceMotion) return;

      var number = ring.querySelector(".ring-number");
      var arc = ring.querySelector(".ring-value");
      var start = null;
      var duration = 600;
      ring.classList.add("is-changed");
      number.textContent = String(from);
      arc.setAttribute("stroke-dasharray", from + " 100");
      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        var value = from + (to - from) * eased;
        number.textContent = String(Math.round(value));
        arc.setAttribute("stroke-dasharray", value.toFixed(2) + " 100");
        if (t < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    });
    shownScores = next;
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

  function message(role) {
    var li = el("li", "msg msg-" + role);
    if (role === "agent") li.appendChild(el("span", "avatar", "AI"));
    var bubble = el("div", "bubble");
    li.appendChild(bubble);
    return { li: li, bubble: bubble };
  }

  // ---------- Scorecard (shown on hover/focus, or pinned with the info button) ----------

  function renderScorecard(item) {
    var doc = item.doc;
    var result = item.result;
    var wrap = el("div", "scorecard");
    wrap.id = "scorecard-" + doc.id;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Scorecard: " + doc.title);
    var card = el("div", "scorecard-inner");

    var top = el("div", "sc-top");
    var titles = el("div", null);
    titles.appendChild(el("p", "sc-title", doc.title));
    titles.appendChild(el("p", "sc-type", SOURCE_TYPE_LABELS[doc.sourceType] || doc.sourceType));
    top.appendChild(titles);
    var badge = el("div", "sc-badge");
    badge.appendChild(scoreRing(result, doc.id, "lg"));
    badge.appendChild(trustPill(result));
    top.appendChild(badge);
    card.appendChild(top);

    if (result.hardStops.length) {
      var stops = el("ul", "hard-stops");
      result.hardStops.forEach(function (hs) {
        stops.appendChild(el("li", null, "⚠ " + hs.label));
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
    card.appendChild(toggle);
    var content = el("blockquote", "doc-content", doc.content);
    content.id = contentId;
    content.hidden = !expanded;
    card.appendChild(content);

    wrap.appendChild(card);
    return wrap;
  }

  // ---------- Document list (agent reply to a question) ----------

  function renderDocRow(item, isTop) {
    var doc = item.doc;
    var result = item.result;
    var selected = state.selectedDocId === doc.id;
    var open = state.openCard === doc.id;

    var li = el("li", "doc" + (selected ? " is-selected" : "") + (open ? " is-open" : ""));
    var row = el("div", "doc-row");

    var main = button("", "doc-main", "use-" + doc.id, function () {
      selectDoc(doc.id);
    });
    main.setAttribute("aria-pressed", selected ? "true" : "false");
    main.setAttribute("aria-label", "Use " + doc.title + ", trust score " + result.score + ", " + result.level);
    main.appendChild(scoreRing(result, doc.id, "md"));

    var text = el("span", "doc-text");
    text.appendChild(el("span", "doc-title", doc.title));
    var sub = (SOURCE_TYPE_LABELS[doc.sourceType] || doc.sourceType) + " · " + doc.team + " · " + doc.year;
    text.appendChild(el("span", "doc-sub", sub));
    var tags = el("span", "doc-tags");
    tags.appendChild(trustPill(result));
    if (isTop) tags.appendChild(el("span", "tag tag-recommended", "Recommended"));
    var delta = state.snapshot[doc.id];
    if (delta) tags.appendChild(el("span", "tag tag-delta", formatDelta(delta) + " since last question"));
    result.hardStops.forEach(function (hs) {
      tags.appendChild(el("span", "tag tag-stop", "⚠ " + hs.label));
    });
    if (tags.childNodes.length) text.appendChild(tags);
    main.appendChild(text);
    row.appendChild(main);

    var info = button("i", "doc-info", "info-" + doc.id, function () {
      toggleCard(doc.id);
    });
    info.setAttribute("aria-label", (open ? "Hide" : "Show") + " scorecard for " + doc.title);
    info.setAttribute("aria-expanded", open ? "true" : "false");
    info.setAttribute("aria-controls", "scorecard-" + doc.id);
    row.appendChild(info);

    li.appendChild(row);
    li.appendChild(renderScorecard(item));
    return li;
  }

  function renderDocsMessage(ranked) {
    var m = message("agent");
    var top = ranked[0];
    m.bubble.appendChild(el("p", null,
      "I found " + ranked.length + " documents about meal vouchers. I recommend “" + top.doc.title +
      "” (trust " + top.result.score + ", " + top.result.level + ")."));
    m.bubble.appendChild(el("p", "hint",
      "Hover a document (or use the ⓘ button) to see its scorecard. Click a document to get the answer from it."));
    var list = el("ul", "doc-list");
    list.setAttribute("aria-label", "Sources found (" + ranked.length + ")");
    ranked.forEach(function (item, i) {
      list.appendChild(renderDocRow(item, i === 0));
    });
    m.bubble.appendChild(list);
    return m.li;
  }

  // ---------- Answer (agent reply to a selected document) ----------

  function renderAnswerMessage(item) {
    var m = message("agent");
    var b = m.bubble;
    b.classList.add("bubble-answer");
    b.appendChild(el("p", "answer-text", ANSWERS[currentQuestion().id][item.doc.id]));

    var based = el("div", "based-on");
    based.appendChild(scoreRing(item.result, item.doc.id, "sm"));
    var basedText = el("span", "based-on-text");
    basedText.appendChild(el("span", "based-on-label", "Based on"));
    basedText.appendChild(el("span", "based-on-title", item.doc.title));
    based.appendChild(basedText);
    based.appendChild(trustPill(item.result));
    b.appendChild(based);

    if (item.result.level === "Low") {
      var warn = el("div", "notice notice-low");
      if (item.result.hardStops.length) {
        item.result.hardStops.forEach(function (hs) {
          warn.appendChild(el("p", null, "⚠ Careful: " + hs.warning));
        });
      } else {
        warn.appendChild(el("p", null, "⚠ Careful: this document has low trust."));
      }
      b.appendChild(warn);
    } else if (item.result.level === "Medium") {
      b.appendChild(el("div", "notice notice-medium", "Medium trust: consider checking a stronger source."));
    }

    var voteRow = el("div", "vote-row");
    voteRow.appendChild(el("span", "vote-question", "Did this help with your customer?"));
    var current = userVote(item.doc.id);
    var up = button("👍", "btn-vote" + (current === 1 ? " is-pressed" : ""), "vote-up", function () {
      vote(item.doc.id, 1);
    });
    up.setAttribute("aria-pressed", current === 1 ? "true" : "false");
    up.setAttribute("aria-label", "Yes, this helped (upvote)");
    var down = button("👎", "btn-vote" + (current === -1 ? " is-pressed" : ""), "vote-down", function () {
      vote(item.doc.id, -1);
    });
    down.setAttribute("aria-pressed", current === -1 ? "true" : "false");
    down.setAttribute("aria-label", "No, this did not help (downvote)");
    var voteButtons = el("span", "vote-buttons");
    voteButtons.appendChild(up);
    voteButtons.appendChild(down);
    voteRow.appendChild(voteButtons);
    var isLast = state.questionIndex === QUESTIONS.length - 1;
    var spacer = el("span", "spacer");
    voteRow.appendChild(spacer);
    voteRow.appendChild(button(isLast ? "Start over" : "Next question", "btn btn-primary btn-small", "next", goToNextQuestion));
    b.appendChild(voteRow);
    return m.li;
  }

  function renderHistory(turn) {
    var frag = document.createDocumentFragment();
    var u = message("user");
    u.bubble.textContent = turn.question;
    frag.appendChild(u.li);
    if (turn.answer) {
      var a = message("agent");
      a.bubble.appendChild(el("p", null, turn.answer));
      a.bubble.appendChild(el("p", "based-on", "Based on: " + turn.docTitle));
      frag.appendChild(a.li);
    }
    return frag;
  }

  function render() {
    // Remember which control had focus so keyboard users keep their place after re-render.
    var active = document.activeElement;
    var focusKey = active && active.getAttribute ? active.getAttribute("data-focus-key") : null;

    var q = currentQuestion();
    var thread = document.getElementById("thread");
    thread.textContent = "";

    var intro = message("agent");
    intro.bubble.textContent = "Hi! Ask me a payroll question. I’ll show you the documents I found and how much you can trust each one.";
    thread.appendChild(intro.li);

    state.history.forEach(function (turn) {
      thread.appendChild(renderHistory(turn));
    });

    if (state.sent) {
      var u = message("user");
      u.bubble.textContent = q.text;
      thread.appendChild(u.li);

      var ranked = rankedDocs();
      thread.appendChild(renderDocsMessage(ranked));

      for (var i = 0; i < ranked.length; i++) {
        if (ranked[i].doc.id === state.selectedDocId) thread.appendChild(renderAnswerMessage(ranked[i]));
      }
    }

    // Composer: the demo question is pre-filled until it is sent.
    document.getElementById("question-label").textContent =
      "Question " + (state.questionIndex + 1) + " of " + QUESTIONS.length;
    document.getElementById("country-chip").textContent = "Country: " + CONTEXT.countryName;
    var input = document.getElementById("question-input");
    var sendBtn = document.getElementById("send-btn");
    input.value = state.sent ? "" : q.text;
    input.placeholder = state.sent ? "Pick a document above to get the answer" : "";
    sendBtn.disabled = state.sent;

    animateScoreChanges();

    if (focusKey) {
      var target = document.querySelector('[data-focus-key="' + focusKey + '"]');
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  // ---------- Init ----------

  document.getElementById("reset-btn").addEventListener("click", resetDemo);
  document.getElementById("composer").addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });
  document.getElementById("question-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.openCard) {
      var key = "info-" + state.openCard;
      state.openCard = null;
      render();
      var info = document.querySelector('[data-focus-key="' + key + '"]');
      if (info) info.focus();
    }
  });
  loadState();
  render();

  // Exposed for console testing only.
  window.scoreDocument = scoreDocument;
})();
