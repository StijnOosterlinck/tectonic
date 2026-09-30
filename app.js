// Payroll Knowledge Assistant – state, scoring, conflict logic, rendering, event handlers.
// Data comes from data.js (loaded first). DOM is built with createElement/textContent only.

(function () {
  "use strict";

  var STORAGE_KEYS = {
    votes: "trustDemo.votes",
    questionIndex: "trustDemo.questionIndex",
    snapshot: "trustDemo.snapshot",
    conflicts: "trustDemo.conflicts",
    docStatus: "trustDemo.docStatus",
    skipped: "trustDemo.skipped",
    userId: "trustDemo.userId"
  };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- Lookups and formatting ----------

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findDoc(id) {
    return byId(DOCUMENTS, id);
  }

  function findUser(id) {
    return byId(USERS, id);
  }

  function formatDelta(n) {
    if (n > 0) return "+" + n;
    if (n < 0) return "−" + Math.abs(n);
    return "0";
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  // "2026-09-30" -> "30 Sep 2026"
  function formatDate(iso) {
    var parts = String(iso).split("-");
    if (parts.length !== 3) return String(iso);
    return parseInt(parts[2], 10) + " " + MONTHS[parseInt(parts[1], 10) - 1] + " " + parts[0];
  }

  function otherDocId(conflict, docId) {
    return conflict.docA === docId ? conflict.docB : conflict.docA;
  }

  function involves(conflict, docId) {
    return conflict.docA === docId || conflict.docB === docId;
  }

  function isUnresolved(conflict) {
    return conflict.status === "open" || conflict.status === "sent";
  }

  // ---------- Scoring (pure) ----------

  // doc: static document data plus runtime `status`.
  // conflicts: all conflicts with their runtime state merged in.
  // context: { country, demoDate, titleOf(docId), userName(userId) }
  function scoreDocument(doc, netVotes, conflicts, context) {
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

    // Open or sent conflicts: one penalty per document, however many conflicts.
    var openWith = conflicts.filter(function (c) {
      return involves(c, doc.id) && isUnresolved(c);
    }).map(function (c) {
      return context.titleOf(otherDocId(c, doc.id));
    });
    if (openWith.length) {
      reasons.push("Open conflict with " + openWith.join(" and ") + ": " + formatDelta(-cfg.openConflictPenalty));
      score -= cfg.openConflictPenalty;
    }

    // Won at least one resolved conflict: one bonus per document.
    var won = conflicts.filter(function (c) {
      return c.status === "resolved" && c.winner === doc.id;
    });
    if (won.length) {
      reasons.push("Confirmed by " + context.userName(won[0].resolvedBy) + ": " + formatDelta(cfg.expertConfirmedBonus));
      score += cfg.expertConfirmedBonus;
    }

    var raw = Math.max(0, Math.min(100, score));

    // Hard stops. ISO dates compare correctly as strings.
    if (doc.validUntil && doc.validUntil < context.demoDate) {
      hardStops.push({ label: "Expired", warning: "this document expired on " + formatDate(doc.validUntil) + "." });
    }
    if (doc.status === "superseded") {
      var lost = conflicts.filter(function (c) {
        return c.status === "resolved" && c.type === "contradiction" && involves(c, doc.id) && c.winner !== doc.id;
      })[0];
      var detail = lost
        ? context.titleOf(lost.winner) + ", decided by " + context.userName(lost.resolvedBy) + " on " + formatDate(lost.resolvedAt)
        : "a newer document";
      hardStops.push({
        label: "Superseded by " + detail,
        warning: "this document is superseded by " + detail + "."
      });
    }
    if (doc.country !== context.country) {
      hardStops.push({
        label: "Wrong country: " + doc.country + ", question is about " + context.country,
        warning: "this document is about " + (COUNTRY_NAMES[doc.country] || doc.country) +
          ", the question is about " + (COUNTRY_NAMES[context.country] || context.country) + "."
      });
    }

    var finalScore = raw;
    var level;
    if (hardStops.length > 0) {
      finalScore = Math.min(raw, cfg.hardStopCap);
      level = "Low";
    } else if (raw >= cfg.thresholds.high) {
      level = "High";
    } else if (raw >= cfg.thresholds.medium) {
      level = "Medium";
    } else {
      level = "Low";
    }

    return { raw: raw, score: finalScore, level: level, reasons: reasons, hardStops: hardStops };
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

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // ---------- State ----------

  var state = {
    userId: DEFAULT_USER_ID,
    questionIndex: 0,
    votes: {},          // { [userId]: { [questionId]: { [docId]: 1 | -1 } } }
    snapshot: {},       // { [docId]: vote delta added during the previous question }
    conflicts: {},      // { [conflictId]: { status, winner, resolvedBy, resolvedAt } }
    docStatus: {},      // { [docId]: "active" | "superseded" | "archived" }
    skipped: {},        // { [questionId]: [conflictId] }
    sent: false,        // current question sent in the chat
    history: [],        // finished exchanges shown in the chat: { question, answer, docTitle }
    selectedDocId: null,
    openCard: null,     // docId whose scorecard is pinned open
    expanded: {},       // { [docId]: true } – "View document" open
    dialog: null        // { mode: "popup" | "inbox", view: "conflict" | "resolve" | "list", conflictId, queue, index }
  };

  function loadState() {
    var userId = load(STORAGE_KEYS.userId, DEFAULT_USER_ID);
    state.userId = findUser(userId) ? userId : DEFAULT_USER_ID;

    var qi = load(STORAGE_KEYS.questionIndex, 0);
    state.questionIndex = qi === 1 ? 1 : 0;

    // Votes are keyed by user; anything in another shape (e.g. an older demo version) is dropped.
    var votes = load(STORAGE_KEYS.votes, {});
    var validVotes = isPlainObject(votes) && Object.keys(votes).every(function (k) {
      return !!findUser(k) && isPlainObject(votes[k]);
    });
    state.votes = validVotes ? votes : {};

    var snap = load(STORAGE_KEYS.snapshot, {});
    state.snapshot = isPlainObject(snap) ? snap : {};
    var conflicts = load(STORAGE_KEYS.conflicts, {});
    state.conflicts = isPlainObject(conflicts) ? conflicts : {};
    var docStatus = load(STORAGE_KEYS.docStatus, {});
    state.docStatus = isPlainObject(docStatus) ? docStatus : {};
    var skipped = load(STORAGE_KEYS.skipped, {});
    state.skipped = isPlainObject(skipped) ? skipped : {};
  }

  function persist() {
    save(STORAGE_KEYS.userId, state.userId);
    save(STORAGE_KEYS.votes, state.votes);
    save(STORAGE_KEYS.questionIndex, state.questionIndex);
    save(STORAGE_KEYS.snapshot, state.snapshot);
    save(STORAGE_KEYS.conflicts, state.conflicts);
    save(STORAGE_KEYS.docStatus, state.docStatus);
    save(STORAGE_KEYS.skipped, state.skipped);
  }

  function currentQuestion() {
    return QUESTIONS[state.questionIndex];
  }

  function currentUser() {
    return findUser(state.userId);
  }

  function docStatus(docId) {
    return state.docStatus[docId] || "active";
  }

  function allConflicts() {
    return CONFLICTS.map(function (c) {
      var rt = state.conflicts[c.id] || {};
      return {
        id: c.id,
        type: c.type,
        docA: c.docA,
        docB: c.docB,
        explanation: c.explanation,
        status: rt.status || "open",
        winner: rt.winner || null,
        resolvedBy: rt.resolvedBy || null,
        resolvedAt: rt.resolvedAt || null
      };
    });
  }

  function findConflict(id) {
    return byId(allConflicts(), id);
  }

  function conflictTeams(conflict) {
    var teams = [findDoc(conflict.docA).team, findDoc(conflict.docB).team];
    return teams[0] === teams[1] ? [teams[0]] : teams;
  }

  // A user may resolve a conflict only if they are an expert for at least one of its owning teams.
  function canResolve(user, conflict) {
    if (!user || user.role !== "expert") return false;
    return conflictTeams(conflict).some(function (team) {
      return user.expertForTeams.indexOf(team) !== -1;
    });
  }

  // First expert whose teams match, and the matching team to mention.
  function expertFor(conflict) {
    var teams = conflictTeams(conflict);
    for (var i = 0; i < USERS.length; i++) {
      var u = USERS[i];
      if (u.role !== "expert") continue;
      for (var j = 0; j < u.expertForTeams.length; j++) {
        if (teams.indexOf(u.expertForTeams[j]) !== -1) return { user: u, team: u.expertForTeams[j] };
      }
    }
    return null;
  }

  function netVotesFor(doc) {
    var total = doc.baseVotes;
    Object.keys(state.votes).forEach(function (uid) {
      var perQuestion = state.votes[uid] || {};
      Object.keys(perQuestion).forEach(function (qid) {
        var v = perQuestion[qid] && perQuestion[qid][doc.id];
        if (v === 1 || v === -1) total += v;
      });
    });
    return total;
  }

  function userVote(docId) {
    var perQuestion = state.votes[state.userId] || {};
    var q = perQuestion[currentQuestion().id];
    return q ? q[docId] || 0 : 0;
  }

  var scoringContext = {
    country: CONTEXT.country,
    demoDate: DEMO_DATE,
    titleOf: function (docId) {
      var d = findDoc(docId);
      return d ? d.title : docId;
    },
    userName: function (userId) {
      var u = findUser(userId);
      return u ? u.name : "an expert";
    }
  };

  function scoredDoc(doc, conflicts) {
    var withStatus = Object.assign({}, doc, { status: docStatus(doc.id) });
    var net = netVotesFor(doc);
    return { doc: withStatus, net: net, result: scoreDocument(withStatus, net, conflicts, scoringContext) };
  }

  // Archived documents are not scored and not shown.
  function rankedDocs() {
    var conflicts = allConflicts();
    var list = DOCUMENTS.filter(function (doc) {
      return docStatus(doc.id) !== "archived";
    }).map(function (doc) {
      return scoredDoc(doc, conflicts);
    });
    list.sort(function (a, b) {
      if (b.result.score !== a.result.score) return b.result.score - a.result.score;
      return b.result.raw - a.result.raw;
    });
    return list;
  }

  function scoredById(docId) {
    return scoredDoc(findDoc(docId), allConflicts());
  }

  // ---------- Toast ----------

  var toastTimer = null;

  function showToast(text, kind) {
    var toast = document.getElementById("toast");
    // While a modal dialog is open everything else is inert, so show the toast inside it.
    var dialog = document.getElementById("conflict-dialog");
    var host = dialog.open ? dialog : document.body;
    if (toast.parentNode !== host) host.appendChild(toast);
    toast.textContent = text;
    toast.className = "toast" + (kind === "error" ? " toast-error" : "");
    toast.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 3200);
  }

  // ---------- Conflict actions ----------

  function eligibleForPopup(conflict) {
    var skipped = state.skipped[currentQuestion().id] || [];
    return conflict.status === "open" &&
      docStatus(conflict.docA) !== "archived" &&
      docStatus(conflict.docB) !== "archived" &&
      skipped.indexOf(conflict.id) === -1;
  }

  // Opens the pop-up for open, non-skipped conflicts among the shown documents (one at a time).
  function checkConflicts() {
    if (!state.sent || state.dialog) return;
    var queue = allConflicts().filter(eligibleForPopup).map(function (c) {
      return c.id;
    });
    if (!queue.length) return;
    state.dialog = { mode: "popup", view: "conflict", queue: queue, index: 0, conflictId: queue[0] };
    renderDialog();
  }

  // Move to the next conflict in the pop-up queue, or close the pop-up.
  function advancePopup() {
    var d = state.dialog;
    var next = d.index + 1;
    while (next < d.queue.length && !eligibleForPopup(findConflict(d.queue[next]))) next++;
    if (next < d.queue.length) {
      d.index = next;
      d.conflictId = d.queue[next];
      d.view = "conflict";
    } else {
      state.dialog = null;
    }
    render();
    if (!state.dialog) focusAfterDialog();
  }

  function skipConflict(conflictId) {
    var qid = currentQuestion().id;
    if (!state.skipped[qid]) state.skipped[qid] = [];
    if (state.skipped[qid].indexOf(conflictId) === -1) state.skipped[qid].push(conflictId);
    persist();
    advancePopup();
  }

  function sendToExpert(conflictId) {
    var conflict = findConflict(conflictId);
    var expert = expertFor(conflict);
    if (!expert) {
      showToast("No expert found for this conflict.", "error");
      return;
    }
    state.conflicts[conflictId] = { status: "sent" };
    persist();
    advancePopup();
    showToast("Sent to " + expert.user.name + " (" + expert.team + ")");
  }

  // Resolve a conflict. Permission is checked here, not only by disabling buttons.
  // Client-side only in this demo; real authorization would happen on a server (phase 2).
  function resolveConflict(conflictId, winnerId) {
    var conflict = findConflict(conflictId);
    var user = currentUser();
    if (!conflict) {
      showToast("Unknown conflict.", "error");
      return false;
    }
    if (!canResolve(user, conflict)) {
      showToast("Not allowed: only experts of " + conflictTeams(conflict).join(" or ") + " can resolve this conflict.", "error");
      return false;
    }
    if (conflict.status === "resolved") {
      showToast("This conflict is already resolved.", "error");
      return false;
    }
    if (winnerId !== conflict.docA && winnerId !== conflict.docB) {
      showToast("Pick one of the two documents in this conflict.", "error");
      return false;
    }

    var loserId = otherDocId(conflict, winnerId);
    state.conflicts[conflictId] = {
      status: "resolved",
      winner: winnerId,
      resolvedBy: user.id,
      resolvedAt: DEMO_DATE
    };
    state.docStatus[loserId] = conflict.type === "contradiction" ? "superseded" : "archived";
    if (state.docStatus[loserId] === "archived") {
      if (state.selectedDocId === loserId) state.selectedDocId = null;
      if (state.openCard === loserId) state.openCard = null;
    }
    persist();

    if (state.dialog && state.dialog.mode === "popup") {
      advancePopup();
    } else if (state.dialog && state.dialog.mode === "inbox") {
      state.dialog.view = "list";
      state.dialog.conflictId = null;
      render();
    } else {
      render();
    }
    showToast("Conflict resolved");
    return true;
  }

  function inboxConflicts() {
    var user = currentUser();
    return allConflicts().filter(function (c) {
      return c.status === "sent" && canResolve(user, c);
    });
  }

  function openInbox() {
    if (currentUser().role !== "expert") return;
    state.dialog = { mode: "inbox", view: "list", conflictId: null };
    render();
  }

  // Escape (the dialog's cancel event) behaves exactly like Skip in the pop-up; it closes the inbox.
  function dismissDialog() {
    var d = state.dialog;
    if (!d) return;
    if (d.mode === "popup") {
      skipConflict(d.conflictId);
    } else {
      state.dialog = null;
      render();
      var inboxBtn = document.getElementById("inbox-btn");
      if (!inboxBtn.hidden) inboxBtn.focus();
    }
  }

  function focusAfterDialog() {
    var target = document.querySelector("[data-focus-key^='use-']") || document.getElementById("send-btn");
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }

  // ---------- Other actions ----------

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
    checkConflicts();
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
    if (!state.votes[state.userId]) state.votes[state.userId] = {};
    var perQuestion = state.votes[state.userId];
    if (!perQuestion[qid]) perQuestion[qid] = {};
    if (perQuestion[qid][docId] === value) {
      delete perQuestion[qid][docId];
    } else {
      perQuestion[qid][docId] = value;
    }
    persist();
    render();
  }

  function switchRole(userId) {
    if (!findUser(userId) || userId === state.userId) return;
    state.userId = userId;
    persist();
    render();
    checkConflicts();
  }

  function goToNextQuestion() {
    var isLast = state.questionIndex === QUESTIONS.length - 1;
    var prevQid = currentQuestion().id;

    // Keep the finished exchange visible in the chat (Start over clears it).
    if (isLast) {
      state.history = [];
    } else {
      var doc = findDoc(state.selectedDocId);
      state.history.push({
        question: currentQuestion().text,
        answer: doc ? ANSWERS[prevQid][doc.id] : "",
        docTitle: doc ? doc.title : ""
      });
    }

    // Snapshot the votes (all users) added during the question that is ending.
    var snap = {};
    Object.keys(state.votes).forEach(function (uid) {
      var q = (state.votes[uid] || {})[prevQid] || {};
      Object.keys(q).forEach(function (docId) {
        var v = q[docId];
        if (v === 1 || v === -1) snap[docId] = (snap[docId] || 0) + v;
      });
    });
    Object.keys(snap).forEach(function (docId) {
      if (!snap[docId]) delete snap[docId];
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
    Object.keys(STORAGE_KEYS).forEach(function (k) {
      removeKey(STORAGE_KEYS[k]);
    });
    state.userId = DEFAULT_USER_ID;
    state.questionIndex = 0;
    state.votes = {};
    state.snapshot = {};
    state.conflicts = {};
    state.docStatus = {};
    state.skipped = {};
    state.sent = false;
    state.history = [];
    state.selectedDocId = null;
    state.openCard = null;
    state.expanded = {};
    state.dialog = null;
    render();
    window.scrollTo(0, 0);
    checkConflicts();
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
    // Keep scores of documents not on screen right now (e.g. hidden behind the dialog state).
    Object.keys(next).forEach(function (k) {
      shownScores[k] = next[k];
    });
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

  // Conflict badges for a document: yellow for open/sent conflicts, green when it won one.
  function conflictBadges(docId) {
    var badges = [];
    var conflicts = allConflicts().filter(function (c) {
      return involves(c, docId);
    });
    conflicts.forEach(function (c) {
      if (c.status === "open") {
        var other = findDoc(otherDocId(c, docId)).title;
        var text = c.type === "contradiction" ? "⚠ Contradicts: " + other : "⚠ Duplicate of: " + other;
        badges.push(el("span", "tag tag-conflict", text));
      }
    });
    if (conflicts.some(function (c) { return c.status === "sent"; })) {
      badges.push(el("span", "tag tag-conflict", "⏳ Waiting for expert"));
    }
    var won = conflicts.filter(function (c) {
      return c.status === "resolved" && c.winner === docId;
    })[0];
    if (won) badges.push(el("span", "tag tag-confirmed", "✓ Confirmed by " + scoringContext.userName(won.resolvedBy)));
    return badges;
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
    main.setAttribute("aria-label", "Use this document: " + doc.title + ", trust score " + result.score + ", " + result.level);
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
    conflictBadges(doc.id).forEach(function (b) {
      tags.appendChild(b);
    });
    text.appendChild(tags);
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

  function archivedLine() {
    var archived = DOCUMENTS.filter(function (d) {
      return docStatus(d.id) === "archived";
    });
    if (!archived.length) return null;
    var parts = archived.map(function (d) {
      var c = allConflicts().filter(function (x) {
        return x.status === "resolved" && involves(x, d.id) && x.winner !== d.id;
      })[0];
      return d.title + (c ? " (archived by " + scoringContext.userName(c.resolvedBy) + ")" : "");
    });
    var label = archived.length === 1 ? "1 archived duplicate hidden: " : archived.length + " archived duplicates hidden: ";
    return el("p", "archived-line", label + parts.join(", "));
  }

  function renderDocsMessage(ranked) {
    var m = message("agent");
    var top = ranked[0];
    m.bubble.appendChild(el("p", null,
      "I found " + ranked.length + " documents about meal vouchers. I recommend “" + top.doc.title +
      "” (trust " + top.result.score + ", " + top.result.level + ")."));
    m.bubble.appendChild(el("p", "hint",
      "Hover a document (or use the ⓘ button) to see its scorecard. Click a document to get the answer from it."));
    var heading = el("p", "sources-heading", "Sources found (" + ranked.length + ")");
    heading.id = "sources-heading";
    m.bubble.appendChild(heading);
    var list = el("ul", "doc-list");
    list.setAttribute("aria-labelledby", "sources-heading");
    ranked.forEach(function (item, i) {
      list.appendChild(renderDocRow(item, i === 0));
    });
    m.bubble.appendChild(list);
    var archived = archivedLine();
    if (archived) m.bubble.appendChild(archived);
    return m.li;
  }

  // ---------- Answer (agent reply to a selected document) ----------

  function renderAnswerMessage(item) {
    var m = message("agent");
    var b = m.bubble;
    b.classList.add("bubble-answer");
    var heading = el("p", "answer-heading", "Answer");
    b.appendChild(heading);
    b.appendChild(el("p", "answer-text", ANSWERS[currentQuestion().id][item.doc.id]));

    var based = el("div", "based-on");
    based.appendChild(scoreRing(item.result, item.doc.id, "sm"));
    var basedText = el("span", "based-on-text");
    basedText.appendChild(el("span", "based-on-label", "Based on"));
    basedText.appendChild(el("span", "based-on-title", item.doc.title));
    based.appendChild(basedText);
    based.appendChild(trustPill(item.result));
    conflictBadges(item.doc.id).forEach(function (badge) {
      if (badge.classList.contains("tag-confirmed")) based.appendChild(badge);
    });
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

    allConflicts().filter(function (c) {
      return involves(c, item.doc.id) && isUnresolved(c);
    }).forEach(function (c) {
      b.appendChild(el("div", "notice notice-medium",
        "This document is in an unresolved conflict with " + findDoc(otherDocId(c, item.doc.id)).title + "."));
    });

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

  // ---------- Conflict dialog (pop-up, resolve view, inbox) ----------

  var closingByCode = false;

  function dialogDocBox(docId) {
    var item = scoredById(docId);
    var box = el("div", "dlg-doc");
    var top = el("div", "dlg-doc-top");
    top.appendChild(scoreRing(item.result, docId, "md"));
    var titles = el("div", "dlg-doc-titles");
    titles.appendChild(el("p", "dlg-doc-title", item.doc.title));
    titles.appendChild(el("p", "dlg-doc-sub", item.doc.team + " · " + item.doc.year));
    titles.appendChild(trustPill(item.result));
    top.appendChild(titles);
    box.appendChild(top);
    box.appendChild(el("blockquote", "doc-content", item.doc.content));
    return box;
  }

  function conflictTitle(conflict) {
    return conflict.type === "contradiction" ? "Contradicting sources found" : "Duplicate sources found";
  }

  function renderConflictView(body, conflict) {
    var d = state.dialog;
    var user = currentUser();
    body.appendChild(el("p", "dlg-eyebrow", "Conflict " + (d.index + 1) + " of " + d.queue.length));
    var title = el("h2", "dlg-title", conflictTitle(conflict));
    title.id = "dialog-title";
    body.appendChild(title);
    body.appendChild(el("p", "dlg-explanation", conflict.explanation));

    var docs = el("div", "dlg-docs");
    docs.appendChild(dialogDocBox(conflict.docA));
    docs.appendChild(dialogDocBox(conflict.docB));
    body.appendChild(docs);

    var actions = el("div", "dlg-actions");
    var allowed = canResolve(user, conflict);
    var expertBtn = button("I am expert – resolve now", "btn btn-primary", "dlg-expert", function () {
      state.dialog.view = "resolve";
      render();
    });
    expertBtn.disabled = !allowed;
    var expertWrap = el("div", "dlg-expert");
    expertWrap.appendChild(expertBtn);
    if (!allowed) {
      var why = el("p", "dlg-why", "Only experts of " + conflictTeams(conflict).join(" or ") + " can resolve this.");
      why.id = "dlg-why";
      expertBtn.setAttribute("aria-describedby", "dlg-why");
      expertWrap.appendChild(why);
    }
    actions.appendChild(expertWrap);
    var secondary = el("div", "dlg-secondary");
    secondary.appendChild(button("Send message to expert", "btn btn-secondary", "dlg-send", function () {
      sendToExpert(conflict.id);
    }));
    secondary.appendChild(button("Skip", "btn btn-ghost", "dlg-skip", function () {
      skipConflict(conflict.id);
    }));
    actions.appendChild(secondary);
    body.appendChild(actions);
  }

  function renderResolveView(body, conflict) {
    var d = state.dialog;
    if (d.mode === "popup") body.appendChild(el("p", "dlg-eyebrow", "Conflict " + (d.index + 1) + " of " + d.queue.length));
    var isContradiction = conflict.type === "contradiction";
    var title = el("h2", "dlg-title", isContradiction ? "Which source is correct?" : "Which document should we keep?");
    title.id = "dialog-title";
    body.appendChild(title);
    body.appendChild(el("p", "dlg-explanation", conflict.explanation + (isContradiction
      ? " The other document will be marked as superseded."
      : " The other document will be archived and hidden.")));

    var options = el("div", "dlg-options");
    [conflict.docA, conflict.docB].forEach(function (docId) {
      var t = findDoc(docId).title;
      var label = isContradiction ? t + " is correct" : "Keep " + t + ", archive the other";
      options.appendChild(button(label, "btn dlg-option", "dlg-pick-" + docId, function () {
        resolveConflict(conflict.id, docId);
      }));
    });
    body.appendChild(options);

    var actions = el("div", "dlg-actions dlg-actions-end");
    actions.appendChild(button("Cancel", "btn btn-ghost", "dlg-cancel", function () {
      state.dialog.view = state.dialog.mode === "inbox" ? "list" : "conflict";
      state.dialog.conflictId = state.dialog.mode === "inbox" ? null : state.dialog.conflictId;
      render();
    }));
    body.appendChild(actions);
  }

  function renderInboxView(body) {
    var title = el("h2", "dlg-title", "Conflict inbox");
    title.id = "dialog-title";
    body.appendChild(title);
    var items = inboxConflicts();
    if (!items.length) {
      body.appendChild(el("p", "dlg-empty", "No conflicts waiting. Nice work."));
    } else {
      var list = el("ul", "inbox-list");
      items.forEach(function (c) {
        var li = el("li", "inbox-item");
        var text = el("div", "inbox-text");
        text.appendChild(el("span", "tag tag-conflict", c.type === "contradiction" ? "Contradiction" : "Duplicate"));
        text.appendChild(el("p", "inbox-titles", findDoc(c.docA).title + " vs " + findDoc(c.docB).title));
        text.appendChild(el("p", "inbox-explanation", c.explanation));
        li.appendChild(text);
        li.appendChild(button("Resolve", "btn btn-primary btn-small", "inbox-resolve-" + c.id, function () {
          state.dialog.view = "resolve";
          state.dialog.conflictId = c.id;
          render();
        }));
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    var actions = el("div", "dlg-actions dlg-actions-end");
    actions.appendChild(button("Close", "btn btn-ghost", "dlg-close", dismissDialog));
    body.appendChild(actions);
  }

  function renderDialog() {
    var dialog = document.getElementById("conflict-dialog");
    var d = state.dialog;
    var toast = document.getElementById("toast");

    if (!d) {
      if (dialog.open) {
        closingByCode = true;
        dialog.close();
        closingByCode = false;
      }
      if (toast.parentNode !== document.body) document.body.appendChild(toast);
      return;
    }

    var hadFocusInside = dialog.contains(document.activeElement);
    dialog.textContent = "";
    var body = el("div", "dlg-body");
    var conflict = d.conflictId ? findConflict(d.conflictId) : null;
    if (d.view === "list") {
      renderInboxView(body);
    } else if (d.view === "resolve" && conflict) {
      renderResolveView(body, conflict);
    } else if (conflict) {
      renderConflictView(body, conflict);
    }
    dialog.appendChild(body);
    if (toast.parentNode === dialog || !toast.hidden) dialog.appendChild(toast);

    if (!dialog.open) {
      dialog.showModal();
      hadFocusInside = false;
    }
    if (!hadFocusInside || !dialog.contains(document.activeElement)) {
      var first = dialog.querySelector("button:not(:disabled)");
      if (first) first.focus();
    }
  }

  // ---------- Header ----------

  function renderHeader() {
    var select = document.getElementById("role-select");
    if (!select.options.length) {
      USERS.forEach(function (u) {
        var label = u.role === "expert"
          ? u.name + " – Expert (" + u.expertForTeams.join(", ") + ")"
          : u.name + " – Consultant";
        var opt = el("option", null, label);
        opt.value = u.id;
        select.appendChild(opt);
      });
    }
    select.value = state.userId;

    var inboxBtn = document.getElementById("inbox-btn");
    var isExpert = currentUser().role === "expert";
    inboxBtn.hidden = !isExpert;
    var n = isExpert ? inboxConflicts().length : 0;
    inboxBtn.textContent = "Conflict inbox (" + n + ")";
    inboxBtn.classList.toggle("has-items", n > 0);
  }

  // ---------- Render ----------

  function render() {
    // Remember which control had focus so keyboard users keep their place after re-render.
    var active = document.activeElement;
    var focusKey = active && active.getAttribute ? active.getAttribute("data-focus-key") : null;

    renderHeader();

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

    renderDialog();
    animateScoreChanges();

    if (focusKey) {
      var target = document.querySelector('[data-focus-key="' + focusKey + '"]');
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  // ---------- Init ----------

  document.getElementById("reset-btn").addEventListener("click", resetDemo);
  document.getElementById("inbox-btn").addEventListener("click", openInbox);
  document.getElementById("role-select").addEventListener("change", function (e) {
    switchRole(e.target.value);
  });
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

  var dialogEl = document.getElementById("conflict-dialog");
  // Escape fires "cancel": handle it ourselves so it behaves exactly like Skip.
  dialogEl.addEventListener("cancel", function (e) {
    e.preventDefault();
    dismissDialog();
  });
  // Safety net: if the browser closes the dialog anyway (e.g. repeated Escape), treat it the same way.
  dialogEl.addEventListener("close", function () {
    if (!closingByCode && state.dialog) dismissDialog();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.openCard && !state.dialog) {
      var key = "info-" + state.openCard;
      state.openCard = null;
      render();
      var info = document.querySelector('[data-focus-key="' + key + '"]');
      if (info) info.focus();
    }
  });

  loadState();
  render();
  checkConflicts();

  // Exposed for console testing only. resolveConflict re-checks permission itself.
  window.scoreDocument = scoreDocument;
  window.resolveConflict = resolveConflict;
})();
