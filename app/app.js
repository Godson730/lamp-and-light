/* Lamp & Light — Bible study, weekly fasting & prayer, reminders. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const ICS_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const STORE_KEY = "lamp-light.v1";

  // Running inside the Android app (Capacitor)?
  const Cap = window.Capacitor;
  const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const LN = NATIVE ? Cap.registerPlugin("LocalNotifications") : null;
  const AppPlugin = NATIVE ? Cap.registerPlugin("App") : null;
  const SystemBars = NATIVE ? Cap.registerPlugin("SystemBars") : null;

  /* ================= state ================= */
  const defaults = () => ({
    name: "",
    theme: "system",
    font: 19,
    translation: "kjv",
    last: { book: "John", chapter: 1 },
    highlights: {},          // "John 3:16" -> color
    bookmarks: [],           // [{ref, text, at}]
    chapterNotes: {},        // "John 3" -> text
    lessons: {},             // index -> {steps:[bool], notes}
    fast: { day: 3, type: "normal", start: "06:00", end: "18:00", remind: true },
    fastWeeks: {},           // weekKey -> {points:[bool], journal, done}
    fastHistory: [],         // [{week, date, title, type}]
    alarms: [
      { id: "a-morning", label: "Morning devotion", time: "06:00", days: [0, 1, 2, 3, 4, 5, 6], kind: "study", enabled: true },
      { id: "a-evening", label: "Evening prayer", time: "21:00", days: [0, 1, 2, 3, 4, 5, 6], kind: "prayer", enabled: true }
    ],
    fired: {},               // alarmId -> "YYYY-MM-DD HH:MM"
    snoozes: []              // [{id, label, kind, at}]
  });

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  let alarmSignature = "";
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    if (NATIVE) {
      const sig = JSON.stringify([state.alarms, state.snoozes]);
      if (sig !== alarmSignature) { alarmSignature = sig; syncNativeAlarms(); }
    }
  }

  /* ================= helpers ================= */
  const pad = n => String(n).padStart(2, "0");
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fromMin = min => { min = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; };
  const at = (date, hhmm) => { const d = new Date(date); const [h, m] = hhmm.split(":").map(Number); d.setHours(h, m, 0, 0); return d; };
  const fmtTime = hhmm => at(new Date(), hhmm).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function startOfWeek(d = new Date()) {         // Monday-based week
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return s;
  }
  function weekIndex(d = new Date()) {
    const epoch = new Date(2026, 0, 5);          // a Monday
    return Math.floor(Math.round((startOfWeek(d) - epoch) / 864e5) / 7);
  }
  const cycle = (i, n) => ((i % n) + n) % n;
  const weekKey = d => dateKey(startOfWeek(d));

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); return; } catch (e) { /* try fallback */ }
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? "Copied" : "Couldn't copy on this device");
  }
  function autosave(el, getTarget, savedEl) {
    let timer;
    el.addEventListener("input", () => {
      clearTimeout(timer);
      savedEl.textContent = "Saving…";
      timer = setTimeout(() => {
        getTarget(el.value); save();
        savedEl.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      }, 500);
    });
  }

  /* ================= references ================= */
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ALIASES = { psalm: "Psalms", ps: "Psalms", songofsongs: "Song of Solomon", song: "Song of Solomon", revelations: "Revelation" };
  function findBook(name) {
    const n = norm(name);
    if (!n) return null;
    if (ALIASES[n]) return BOOKS.find(b => b.name === ALIASES[n]);
    return BOOKS.find(b => norm(b.name) === n) || BOOKS.find(b => norm(b.name).startsWith(n)) || null;
  }
  function parseRef(str) {
    const m = String(str).trim().match(/^(.+?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*-\s*(\d+))?)?$/);
    if (!m) { const b = findBook(str); return b ? { book: b.name, chapter: 1 } : null; }
    let [, name, ch, from, to] = m;
    let book = findBook(name);
    // "1 John" typed as "1" + "John 3"? handle numbers that belong to the book name
    if (!book) return null;
    ch = Math.min(Math.max(1, +ch), book.chapters);
    return { book: book.name, chapter: ch, from: from ? +from : null, to: to ? +to : (from ? +from : null) };
  }

  // The full KJV and WEB texts ship with the app: bible/<translation>/<book number>.json = [[verse, ...], ...chapters]
  const bookCache = new Map();
  async function loadBook(bookName, translation) {
    const key = translation + "|" + bookName;
    if (!bookCache.has(key)) {
      const n = BOOKS.findIndex(b => b.name === bookName) + 1;
      const promise = fetch(`bible/${translation}/${n}.json`).then(res => {
        if (!res.ok) throw new Error(`Couldn't open ${bookName}.`);
        return res.json();
      });
      bookCache.set(key, promise);
      promise.catch(() => bookCache.delete(key));
    }
    return bookCache.get(key);
  }
  async function fetchPassage(query, translation = state.translation) {
    const r = parseRef(query);
    if (!r) throw new Error(`Couldn't find ${query}.`);
    const chapter = (await loadBook(r.book, translation))[r.chapter - 1] || [];
    const from = r.from || 1, to = r.to || chapter.length;
    const verses = [];
    for (let n = from; n <= Math.min(to, chapter.length); n++) {
      if (chapter[n - 1]) verses.push({ verse: n, text: chapter[n - 1] });   // WEB leaves a few verses empty (moved to footnotes)
    }
    return { verses };
  }
  function verseText(ref) {
    const v = VERSES.find(x => x.ref === ref);
    return v && state.translation === "kjv" ? Promise.resolve(v.text)
      : fetchPassage(ref).then(d => d.verses.map(v => v.text.trim()).join(" ").replace(/[:;,]$/, ""));
  }

  /* ================= navigation ================= */
  const VIEWS = ["today", "bible", "study", "fast", "alarms"];
  function show(view) {
    if (!VIEWS.includes(view)) view = "today";
    $$(".view").forEach(v => { v.hidden = v.dataset.view !== view; });
    $$(".tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === view));
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    window.scrollTo({ top: 0 });
    render[view]();
  }
  $$(".tabbar button").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (g) show(g.dataset.goto);
    const r = e.target.closest("[data-ref]");
    if (r) {
      $$("dialog[open]").forEach(d => { d.returnValue = ""; d.close(); });
      openRef(r.dataset.ref);
    }
  });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  const render = {};

  /* ================= TODAY ================= */
  function dayOfYear(d = new Date()) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
  render.today = () => {
    const now = new Date();
    $("#todayDate").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const h = now.getHours();
    const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    $("#greeting").textContent = state.name ? `${part}, ${state.name}` : part;

    const v = VERSES[dayOfYear(now) % VERSES.length];
    $("#votdRef").textContent = v.ref + (state.translation === "kjv" ? " (KJV)" : "");
    $("#votdRef").dataset.ref = v.ref;
    $("#votdText").textContent = v.text;
    if (state.translation !== "kjv") {
      verseText(v.ref).then(t => { $("#votdText").textContent = t; $("#votdRef").textContent = v.ref + " (WEB)"; }).catch(() => {});
    }

    // study
    const li = cycle(weekIndex(), LESSONS.length);
    const lesson = LESSONS[li];
    const done = lessonState(li).steps.filter(Boolean).length;
    $("#todayStudyTitle").textContent = lesson.title;
    $("#todayStudyRef").textContent = lesson.passage;
    $("#todayStudyBar").style.width = (done / 4 * 100) + "%";
    $("#todayStudyProgress").textContent = `${done} of 4 steps done`;

    // fast
    const f = fastInfo();
    const card = $("#todayFast");
    const statusLine = {
      upcoming: f.isToday ? `Begins today at ${fmtTime(state.fast.start)}` : `${DAY_NAMES[state.fast.day]} · ${fmtTime(state.fast.start)} – ${fmtTime(state.fast.end)}`,
      active: `In progress — break the fast at ${fmtTime(state.fast.end)}`,
      ended: f.done ? "Completed this week — well done!" : "Did you complete this week's fast?"
    }[f.phase];
    card.innerHTML = `
      <p class="eyebrow">${f.isToday ? "Today is your fasting day" : "Weekly fast"}</p>
      <h2>${escapeHtml(f.week.title)}</h2>
      <p class="muted">${escapeHtml(statusLine)}</p>
      ${f.phase === "active" ? `<div class="progress"><span style="width:${f.pct}%"></span></div>` : ""}
      <div class="row between"><span class="muted small">${escapeHtml(FAST_TYPES[state.fast.type].label)}</span>
      <button class="btn" data-goto="fast">Open guide</button></div>`;

    // next reminder
    const next = nextAlarm();
    $("#nextAlarmLabel").textContent = next ? next.label : "No reminders set";
    $("#nextAlarmWhen").textContent = next ? relWhen(next.when) : "";
    $("#notifPrompt").hidden = permission === "granted" || permission === "unsupported";

    // continue reading
    $("#continueReading").hidden = false;
    $("#continueRef").textContent = `${state.last.book} ${state.last.chapter}`;
  };
  $("#votdShare").addEventListener("click", () => copyText(`“${$("#votdText").textContent}” — ${$("#votdRef").textContent}`));
  function relWhen(d) {
    const today = dateKey(new Date()), tomorrow = dateKey(new Date(Date.now() + 864e5));
    const day = dateKey(d) === today ? "Today" : dateKey(d) === tomorrow ? "Tomorrow" : DAY_NAMES[d.getDay()];
    return `${day} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  /* ================= BIBLE ================= */
  const bookSelect = $("#bookSelect"), chapterSelect = $("#chapterSelect");
  bookSelect.innerHTML = BOOKS.map((b, i) =>
    (i === 0 ? '<optgroup label="Old Testament">' : i === 39 ? '</optgroup><optgroup label="New Testament">' : "") +
    `<option>${b.name}</option>`).join("") + "</optgroup>";

  let pendingFocus = null;
  let currentVerses = [];
  function fillChapters() {
    const book = BOOKS.find(b => b.name === state.last.book);
    chapterSelect.innerHTML = Array.from({ length: book.chapters }, (_, i) => `<option value="${i + 1}">Chapter ${i + 1}</option>`).join("");
  }
  render.bible = () => {
    bookSelect.value = state.last.book;
    fillChapters();
    chapterSelect.value = state.last.chapter;
    $("#translationPill").textContent = state.translation.toUpperCase();
    loadChapter();
    renderBookmarks();
  };
  let loadToken = 0;
  async function loadChapter() {
    const { book, chapter } = state.last;
    const token = ++loadToken;
    const reader = $("#reader");
    $("#chapterTitle").textContent = `${book} ${chapter}`;
    $("#chapterNotes").value = state.chapterNotes[`${book} ${chapter}`] || "";
    $("#chapterNotesSaved").textContent = "";
    reader.innerHTML = `<p class="loading">Loading ${escapeHtml(book)} ${chapter}…</p>`;
    try {
      const data = await fetchPassage(`${book} ${chapter}`);
      if (token !== loadToken) return;
      currentVerses = data.verses.map(v => ({ n: v.verse, text: v.text.replace(/\s+/g, " ").trim() }));
      reader.innerHTML = currentVerses.map(v => {
        const ref = `${book} ${chapter}:${v.n}`;
        const hl = state.highlights[ref];
        const bm = state.bookmarks.some(b => b.ref === ref);
        return `<span class="verse${hl ? " hl-" + hl : ""}${bm ? " bookmarked" : ""}" data-verse="${v.n}" tabindex="0"><sup>${v.n}</sup>${escapeHtml(v.text)}</span> `;
      }).join("");
      if (pendingFocus) {
        const { from, to } = pendingFocus; pendingFocus = null;
        let first;
        for (let n = from; n <= to; n++) {
          const el = reader.querySelector(`[data-verse="${n}"]`);
          if (el) { el.classList.add("focus"); first = first || el; }
        }
        if (first && pendingCommentary == null) setTimeout(() => first.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      }
      if (pendingCommentary != null) {
        const verse = pendingCommentary; pendingCommentary = null;
        $("#commentaryBox").open = true;
        await renderCommentary();
        const notes = $$("#commentaryBody .note");
        const target = notes.find(n => +n.dataset.verse >= verse) || notes[0] || $("#commentaryBox");
        setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      } else if ($("#commentaryBox").open) {
        renderCommentary();
      }
    } catch (err) {
      if (token !== loadToken) return;
      reader.innerHTML = `<p class="error">${escapeHtml(err.message || "Couldn't load this chapter.")}<br>
        <span class="muted">Please close and reopen the app, then try again.</span><br><br>
        <button class="btn ghost small" id="retryChapter">Try again</button></p>`;
      $("#retryChapter").addEventListener("click", loadChapter);
    }
  }
  function goChapter(book, chapter) {
    state.last = { book, chapter }; save();
    bookSelect.value = book; fillChapters(); chapterSelect.value = chapter;
    loadChapter();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function openRef(str) {
    const r = parseRef(str);
    if (!r) { toast(`Couldn't find “${str}”`); return; }
    pendingFocus = r.from ? { from: r.from, to: r.to } : null;
    state.last = { book: r.book, chapter: r.chapter }; save();
    if ($("#view-bible").hidden) show("bible"); else goChapter(r.book, r.chapter);
  }
  bookSelect.addEventListener("change", () => goChapter(bookSelect.value, 1));
  chapterSelect.addEventListener("change", () => goChapter(state.last.book, +chapterSelect.value));
  function step(dir) {
    const bi = BOOKS.findIndex(b => b.name === state.last.book);
    let ch = state.last.chapter + dir, b = bi;
    if (ch < 1) { b = bi - 1; if (b < 0) return; ch = BOOKS[b].chapters; }
    else if (ch > BOOKS[bi].chapters) { b = bi + 1; if (b >= BOOKS.length) return; ch = 1; }
    goChapter(BOOKS[b].name, ch);
  }
  $("#prevChapter").addEventListener("click", () => step(-1));
  $("#nextChapter").addEventListener("click", () => step(1));
  $("#refForm").addEventListener("submit", e => {
    e.preventDefault();
    const q = $("#refInput").value.trim();
    if (q) { openRef(q); $("#refInput").blur(); }
  });
  autosave($("#chapterNotes"), val => {
    const k = `${state.last.book} ${state.last.chapter}`;
    if (val.trim()) state.chapterNotes[k] = val; else delete state.chapterNotes[k];
  }, $("#chapterNotesSaved"));

  // verse sheet
  const sheet = $("#verseSheet");
  let sheetVerse = null;
  function openVerse(el) {
    const n = +el.dataset.verse;
    const v = currentVerses.find(x => x.n === n);
    sheetVerse = { ref: `${state.last.book} ${state.last.chapter}:${n}`, text: v.text };
    $("#verseSheetRef").textContent = sheetVerse.ref;
    $("#verseSheetText").textContent = v.text;
    $("#verseBookmarkBtn").textContent = state.bookmarks.some(b => b.ref === sheetVerse.ref) ? "Remove bookmark" : "Bookmark";
    sheet.returnValue = "";
    sheet.showModal();
  }
  $("#reader").addEventListener("click", e => { const el = e.target.closest(".verse"); if (el) openVerse(el); });
  $("#reader").addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("verse")) { e.preventDefault(); openVerse(e.target); }
  });
  // Act on the tapped button right away (the form's submit event), rather than waiting for the dialog's close event.
  sheet.querySelector("form").addEventListener("submit", e => {
    const action = e.submitter?.value;
    if (!sheetVerse || !action || action === "close") return;
    const { ref, text } = sheetVerse;
    if (["yellow", "green", "blue", "pink"].includes(action)) state.highlights[ref] = action;
    else if (action === "none") delete state.highlights[ref];
    else if (action === "bookmark") {
      const i = state.bookmarks.findIndex(b => b.ref === ref);
      if (i >= 0) state.bookmarks.splice(i, 1);
      else { state.bookmarks.unshift({ ref, text, at: Date.now() }); toast("Bookmarked"); }
    } else if (action === "copy") { copyText(`“${text}” — ${ref} (${state.translation.toUpperCase()})`); return; }
    else if (action === "commentary") { showVerseNote(state.last.book, state.last.chapter, +ref.split(":")[1]); return; }
    save();
    const el = $(`#reader [data-verse="${ref.split(":")[1]}"]`);
    if (el) {
      el.className = "verse" + (state.highlights[ref] ? " hl-" + state.highlights[ref] : "") +
        (state.bookmarks.some(b => b.ref === ref) ? " bookmarked" : "");
    }
    renderBookmarks();
  });

  /* ----- Commentary: Jamieson-Fausset-Brown, bible/commentary/jfb/<book#>.json ----- */
  const commentaryCache = new Map();
  function loadCommentary(bookName) {
    if (!commentaryCache.has(bookName)) {
      const n = BOOKS.findIndex(b => b.name === bookName) + 1;
      const p = fetch(`bible/commentary/jfb/${n}.json`).then(res => {
        if (!res.ok) throw new Error("Commentary unavailable");
        return res.json();
      });
      commentaryCache.set(bookName, p);
      p.catch(() => commentaryCache.delete(bookName));
    }
    return commentaryCache.get(bookName);
  }
  // JFB's own abbreviations ("Joh 3:16") → our book names, so cross-references become tappable
  const JFB_BOOKS = {
    Gen: "Genesis", Exo: "Exodus", Lev: "Leviticus", Num: "Numbers", Deu: "Deuteronomy", Jos: "Joshua", Jdg: "Judges",
    Rut: "Ruth", Ezr: "Ezra", Ezra: "Ezra", Neh: "Nehemiah", Est: "Esther", Job: "Job", Psa: "Psalms", Pro: "Proverbs",
    Ecc: "Ecclesiastes", Sol: "Song of Solomon", Isa: "Isaiah", Jer: "Jeremiah", Lam: "Lamentations", Eze: "Ezekiel",
    Dan: "Daniel", Hos: "Hosea", Joe: "Joel", Joel: "Joel", Amo: "Amos", Oba: "Obadiah", Jon: "Jonah", Mic: "Micah",
    Nah: "Nahum", Hab: "Habakkuk", Zep: "Zephaniah", Hag: "Haggai", Zac: "Zechariah", Mal: "Malachi", Mat: "Matthew",
    Mar: "Mark", Mark: "Mark", Luk: "Luke", Luke: "Luke", Joh: "John", John: "John", Act: "Acts", Acts: "Acts",
    Rom: "Romans", Gal: "Galatians", Eph: "Ephesians", Phi: "Philippians", Col: "Colossians", Tit: "Titus",
    Plm: "Philemon", Heb: "Hebrews", Jam: "James", Jde: "Jude", Rev: "Revelation"
  };
  const JFB_REF = new RegExp(`\\b(${Object.keys(JFB_BOOKS).join("|")}) (\\d{1,3}):(\\d{1,3})(?:-(\\d{1,3}))?`, "g");
  function formatCommentary(text) {
    return text.split(/\n{2,}/).map(par => {
      let html = escapeHtml(par.trim());
      if (!html) return "";
      // JFB opens most paragraphs with the Bible words being explained, followed by "--"
      html = html.replace(/^(.{1,90}?)--/, "<strong>$1</strong> — ").replace(/--/g, " — ");
      html = html.replace(JFB_REF, (m, abbr, ch, v1, v2) => {
        const book = BOOKS.find(b => b.name === JFB_BOOKS[abbr]);
        if (!book || +ch > book.chapters) return m;
        return `<button type="button" class="link ref" data-ref="${book.name} ${ch}:${v1}${v2 ? "-" + v2 : ""}">${m}</button>`;
      });
      return `<p>${html.replace(/\n/g, "<br>")}</p>`;
    }).join("");
  }
  async function renderCommentary() {
    const { book, chapter } = state.last;
    const body = $("#commentaryBody");
    const key = `${book} ${chapter}`;
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    body.innerHTML = `<p class="loading">Loading commentary…</p>`;
    try {
      const data = await loadCommentary(book);
      if (body.dataset.key !== key) return;
      const ch = data.ch[chapter];
      let html = "";
      if (chapter === 1 && data.intro) {
        html += `<details class="intro"><summary>Introduction to ${escapeHtml(book)}</summary>${formatCommentary(data.intro)}</details>`;
      }
      if (!ch) {
        html += `<p class="muted">Jamieson-Fausset-Brown has no commentary on ${escapeHtml(key)}.</p>`;
      } else {
        if (ch.intro) html += `<div class="chapter-intro">${formatCommentary(ch.intro)}</div>`;
        html += ch.notes.map(([v, t]) => `
          <article class="note" data-verse="${v}">
            <h4><button type="button" class="verse-jump" data-jump="${v}">Verse ${v}</button></h4>
            ${formatCommentary(t)}
          </article>`).join("");
      }
      body.innerHTML = html + `<p class="muted small credit">Jamieson, Fausset &amp; Brown (1871) · public domain</p>`;
    } catch (e) {
      body.dataset.key = "";
      body.innerHTML = `<p class="error">Couldn't open the commentary. Please try again.</p>`;
    }
  }
  $("#commentaryBox").addEventListener("toggle", () => { if ($("#commentaryBox").open) renderCommentary(); });
  $("#commentaryBody").addEventListener("click", e => {
    const j = e.target.closest("[data-jump]");
    if (!j) return;
    const el = $(`#reader [data-verse="${j.dataset.jump}"]`);
    if (!el) return;
    $$("#reader .verse.focus").forEach(v => v.classList.remove("focus"));
    el.classList.add("focus");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const noteSheet = $("#noteSheet");
  async function showVerseNote(book, chapter, verse) {
    $("#noteRef").textContent = `${book} ${chapter}:${verse}`;
    $("#noteText").innerHTML = `<p class="loading">Loading…</p>`;
    noteSheet.returnValue = "";
    if (!noteSheet.open) noteSheet.showModal();
    try {
      const ch = (await loadCommentary(book)).ch[chapter];
      const notes = ch ? ch.notes : [];
      const exact = notes.find(([v]) => v === verse);
      // JFB often explains a group of verses under the first one, so fall back to the closest earlier note
      const earlier = notes.filter(([v]) => v < verse && verse - v <= 4).pop();
      const note = exact || earlier;
      $("#noteText").scrollTop = 0;
      $("#noteText").innerHTML = note
        ? (exact ? "" : `<p class="muted small">No note on verse ${verse} itself. Here is the note on verse ${note[0]}:</p>`) + formatCommentary(note[1])
        : `<p class="muted">There's no note on this verse. Tap <strong>Whole chapter</strong> to read the commentary on ${escapeHtml(book)} ${chapter}.</p>`;
      noteSheet.dataset.verse = note ? note[0] : verse;
    } catch (e) {
      $("#noteText").innerHTML = `<p class="error">Couldn't open the commentary.</p>`;
    }
  }
  noteSheet.querySelector("form").addEventListener("submit", e => {
    if (e.submitter?.value !== "chapter") return;
    $("#commentaryBox").open = true;
    renderCommentary().then(() => {
      const target = $(`#commentaryBody .note[data-verse="${noteSheet.dataset.verse}"]`) || $("#commentaryBox");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  let pendingCommentary = null;
  function openCommentaryFor(refStr) {
    const r = parseRef(refStr);
    if (!r) return;
    pendingCommentary = r.from || 1;
    openRef(refStr);
  }

  function renderBookmarks() {
    const refs = new Set([...state.bookmarks.map(b => b.ref), ...Object.keys(state.highlights)]);
    $("#bookmarkCount").textContent = refs.size;
    const list = $("#bookmarkList");
    if (!refs.size) { list.innerHTML = `<li class="muted small">Tap any verse while reading to highlight or bookmark it.</li>`; return; }
    const items = [...refs].map(ref => {
      const bm = state.bookmarks.find(b => b.ref === ref);
      return { ref, text: bm ? bm.text : "", color: state.highlights[ref], bm: !!bm };
    });
    list.innerHTML = items.map(it => `
      <li>
        <span class="dot" style="background:${it.color ? `var(--hl-${it.color})` : "transparent"}"></span>
        <span class="grow"><button class="link" data-ref="${escapeHtml(it.ref)}">${escapeHtml(it.ref)}</button>${it.bm ? " 🔖" : ""}
          ${it.text ? `<span class="snippet">${escapeHtml(it.text)}</span>` : ""}</span>
        <button class="icon-btn" data-remove="${escapeHtml(it.ref)}" aria-label="Remove ${escapeHtml(it.ref)}" style="font-size:1rem">✕</button>
      </li>`).join("");
  }
  $("#bookmarkList").addEventListener("click", e => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    const ref = rm.dataset.remove;
    delete state.highlights[ref];
    state.bookmarks = state.bookmarks.filter(b => b.ref !== ref);
    save(); renderBookmarks();
    const [bc, v] = ref.split(":");
    if (bc === `${state.last.book} ${state.last.chapter}`) { const el = $(`#reader [data-verse="${v}"]`); if (el) el.className = "verse"; }
  });

  /* ================= STUDY ================= */
  let selectedLesson = null;
  function lessonState(i) {
    return state.lessons[i] || (state.lessons[i] = { steps: [false, false, false, false], notes: "" });
  }
  const lessonSelect = $("#lessonSelect");
  lessonSelect.innerHTML = LESSONS.map((l, i) => `<option value="${i}">${i + 1}. ${escapeHtml(l.title)}</option>`).join("");
  lessonSelect.addEventListener("change", () => { selectedLesson = +lessonSelect.value; render.study(); });

  render.study = () => {
    const current = cycle(weekIndex(), LESSONS.length);
    const i = selectedLesson ?? current;
    const l = LESSONS[i];
    const ls = lessonState(i);
    lessonSelect.value = i;
    $("#studyWeekLabel").textContent = i === current
      ? `Week of ${startOfWeek().toLocaleDateString([], { month: "short", day: "numeric" })} · Lesson ${i + 1} of ${LESSONS.length}`
      : `Lesson ${i + 1} of ${LESSONS.length}`;
    $("#lessonTitle").textContent = l.title;
    $("#lessonSummary").textContent = l.summary;
    $("#lessonPassage").textContent = l.passage;
    $("#lessonOpenPassage").dataset.ref = l.passage;
    $("#lessonCommentary").onclick = () => openCommentaryFor(l.passage);
    const kv = $("#lessonKeyVerse");
    kv.textContent = `Key verse: ${l.keyVerse}`;
    verseText(l.keyVerse).then(t => { kv.textContent = `“${t}” — ${l.keyVerse}`; }).catch(() => {});

    const steps = [
      ["Read & observe", `<p>${escapeHtml(l.observe)}</p>`],
      ["Reflect", `<ol>${l.questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ol>`],
      ["Apply", `<p>${escapeHtml(l.apply)}</p>`],
      ["Pray", `<p>${escapeHtml(l.pray)}</p>`]
    ];
    $("#lessonSteps").innerHTML = steps.map(([title, body], s) => `
      <li class="${ls.steps[s] ? "done" : ""}">
        <h3>${title}<label class="done-toggle"><input type="checkbox" data-step="${s}" ${ls.steps[s] ? "checked" : ""}> Done</label></h3>
        ${body}
      </li>`).join("");
    $("#lessonNotes").value = ls.notes || "";
    $("#lessonNotesSaved").textContent = "";
  };
  $("#lessonSteps").addEventListener("change", e => {
    const cb = e.target.closest("[data-step]");
    if (!cb) return;
    const i = selectedLesson ?? cycle(weekIndex(), LESSONS.length);
    lessonState(i).steps[+cb.dataset.step] = cb.checked;
    cb.closest("li").classList.toggle("done", cb.checked);
    save();
    if (lessonState(i).steps.every(Boolean)) toast("Lesson complete — well done!");
  });
  autosave($("#lessonNotes"), val => {
    lessonState(selectedLesson ?? cycle(weekIndex(), LESSONS.length)).notes = val;
  }, $("#lessonNotesSaved"));

  /* ================= FAST ================= */
  function fastWindow(weekStart) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + ((state.fast.day + 6) % 7));
    const start = at(day, state.fast.start);
    const end = at(day, state.fast.end);
    if (end <= start) end.setDate(end.getDate() + 1);   // overnight fast
    return { day, start, end };
  }
  function fastInfo(now = new Date()) {
    // The "current" fast stays this week's until 24h after it ends, then moves to next week's.
    const ws = startOfWeek(now);
    let win = fastWindow(ws);
    if (now - win.end > 864e5) { ws.setDate(ws.getDate() + 7); win = fastWindow(ws); }
    const { day, start, end } = win;
    const key = weekKey(ws);
    const week = FAST_WEEKS[cycle(weekIndex(ws), FAST_WEEKS.length)];
    const fw = fastWeek(key, week);
    let phase = "upcoming";
    if (now >= start && now < end) phase = "active";
    else if (now >= end) phase = "ended";
    const pct = phase === "active" ? Math.round((now - start) / (end - start) * 100) : phase === "ended" ? 100 : 0;
    return { key, week, day, start, end, phase, pct, done: fw.done, isToday: dateKey(day) === dateKey(now) };
  }
  function fastWeek(key, week) {
    return state.fastWeeks[key] || (state.fastWeeks[key] = { points: week.points.map(() => false), journal: "", done: false });
  }
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return d > 0 ? `${d}d ${h}h ${pad(m)}m` : `${h}:${pad(m)}:${pad(sec)}`;
  }

  const fastDaySel = $("#fastDay"), fastTypeSel = $("#fastType");
  fastDaySel.innerHTML = DAY_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join("");
  fastTypeSel.innerHTML = Object.entries(FAST_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
  $("#fastTips").innerHTML = FAST_TIPS.map(t => `<li>${escapeHtml(t)}</li>`).join("");

  render.fast = () => {
    const f = fastInfo();
    const fw = fastWeek(f.key, f.week);
    $("#fastTitle").textContent = f.week.title;
    $("#fastFocus").textContent = f.week.focus;
    renderFastStatus();

    $("#fastScriptures").innerHTML = f.week.scriptures.map(r => `<button class="chip" data-ref="${r}">${r}</button>`).join("");
    $("#fastPrayerPoints").innerHTML = f.week.points.map((p, i) => `
      <li><label><input type="checkbox" data-point="${i}" ${fw.points[i] ? "checked" : ""}><span>${escapeHtml(p)}</span></label></li>`).join("");

    // schedule
    const startM = toMin(state.fast.start);
    let span = toMin(state.fast.end) - startM; if (span <= 0) span += 1440;
    const r5 = m => Math.round(m / 5) * 5;
    const sc = f.week.scriptures;
    const plan = [
      [0, "Begin with consecration", `Confess anything on your heart and surrender the day to God. Read ${sc[0]}.`],
      [span * .25, "Scripture meditation", `Read ${sc.slice(1, 3).join(" and ")} slowly. Write down what stands out.`],
      [span * .5, "Midday prayer", "Use your lunch break to pray through the prayer points above."],
      [span * .75, "Intercession", `Pray for others — family, church and nation. Close with ${sc[3] || sc[0]}.`],
      [span, "Thanksgiving & breaking the fast", "Thank God for strength through the day. Break the fast gently with water and light food."]
    ];
    const nowM = f.isToday && f.phase === "active" ? (new Date() - f.start) / 60000 : -1;
    $("#fastSchedule").innerHTML = plan.map(([off, title, body], i) => {
      const isNow = nowM >= 0 && nowM >= off && (i === plan.length - 1 || nowM < plan[i + 1][0]);
      return `<li class="${isNow ? "now" : ""}"><time>${fmtTime(fromMin(r5(startM + off)))}</time> · <strong>${title}</strong><br><span class="muted">${escapeHtml(body)}</span></li>`;
    }).join("");

    $("#fastJournal").value = fw.journal || "";
    $("#fastJournalSaved").textContent = "";

    fastDaySel.value = state.fast.day;
    fastTypeSel.value = state.fast.type;
    $("#fastStart").value = state.fast.start;
    $("#fastEnd").value = state.fast.end;
    $("#fastRemind").checked = state.fast.remind;
    $("#fastTypeInfo").textContent = FAST_TYPES[state.fast.type].info;

    $("#fastHistoryCount").textContent = state.fastHistory.length;
    $("#fastHistory").innerHTML = state.fastHistory.length
      ? state.fastHistory.slice().reverse().map(h => `<li><span class="grow"><strong>${escapeHtml(h.title)}</strong><br>
          <span class="muted small">${new Date(h.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · ${escapeHtml(FAST_TYPES[h.type]?.label || h.type)}</span></span></li>`).join("")
      : `<li class="muted small">Completed fasts will appear here.</li>`;
  };

  function renderFastStatus() {
    const f = fastInfo(), el = $("#fastStatus");
    const day = f.day.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    const streak = fastStreak();
    const streakTxt = streak > 1 ? `<p class="muted small">🔥 ${streak}-week fasting streak</p>` : "";
    if (f.phase === "upcoming") {
      el.innerHTML = `<p class="eyebrow">${f.isToday ? "Today" : "Next fast"}</p>
        <h2>${day}</h2>
        <p class="muted">${fmtTime(state.fast.start)} – ${fmtTime(state.fast.end)} · ${escapeHtml(FAST_TYPES[state.fast.type].label)}</p>
        <p class="small muted" style="margin:0">Starts in</p>
        <div class="big-count" data-until="${f.start.getTime()}">${countdown(f.start - Date.now())}</div>${streakTxt}`;
    } else if (f.phase === "active") {
      el.innerHTML = `<p class="eyebrow">Fasting now</p>
        <h2>Stay close to God today</h2>
        <p class="small muted" style="margin:0">Time until you break the fast</p>
        <div class="big-count" data-until="${f.end.getTime()}">${countdown(f.end - Date.now())}</div>
        <div class="progress"><span style="width:${f.pct}%"></span></div>
        <div class="row between"><span class="muted small">${f.pct}% complete</span>
        <button class="btn ghost small" id="markFast">${f.done ? "Completed ✓" : "Mark complete"}</button></div>${streakTxt}`;
    } else {
      el.innerHTML = f.done
        ? `<p class="eyebrow">This week</p><h2>Fast completed ✓</h2>
           <p class="muted">Well done. Your next fast is on ${DAY_NAMES[state.fast.day]} next week.</p>
           <button class="btn ghost small" id="markFast">Undo</button>${streakTxt}`
        : `<p class="eyebrow">This week · ${day}</p><h2>Did you complete your fast?</h2>
           <p class="muted">Record it to keep track of your weekly fasting.</p>
           <button class="btn" id="markFast">Yes, mark complete</button>${streakTxt}`;
    }
    const btn = $("#markFast");
    if (btn) btn.addEventListener("click", () => toggleFastDone(f));
  }
  function toggleFastDone(f) {
    const fw = fastWeek(f.key, f.week);
    fw.done = !fw.done;
    state.fastHistory = state.fastHistory.filter(h => h.week !== f.key);
    if (fw.done) { state.fastHistory.push({ week: f.key, date: f.day.getTime(), title: f.week.title, type: state.fast.type }); toast("Fast recorded. God bless you!"); }
    save(); render.fast();
  }
  function fastStreak() {
    let n = 0;
    const d = new Date(fastInfo().day);
    if (!state.fastWeeks[weekKey(d)]?.done) d.setDate(d.getDate() - 7);
    while (state.fastWeeks[weekKey(d)]?.done) { n++; d.setDate(d.getDate() - 7); }
    return n;
  }

  $("#fastPrayerPoints").addEventListener("change", e => {
    const cb = e.target.closest("[data-point]"); if (!cb) return;
    const f = fastInfo();
    fastWeek(f.key, f.week).points[+cb.dataset.point] = cb.checked;
    save();
  });
  autosave($("#fastJournal"), val => { const f = fastInfo(); fastWeek(f.key, f.week).journal = val; }, $("#fastJournalSaved"));

  function updateFastPlan() {
    state.fast = {
      day: +fastDaySel.value, type: fastTypeSel.value,
      start: $("#fastStart").value || "06:00", end: $("#fastEnd").value || "18:00",
      remind: $("#fastRemind").checked
    };
    syncFastAlarms(); save(); render.fast();
  }
  [fastDaySel, fastTypeSel, $("#fastStart"), $("#fastEnd"), $("#fastRemind")].forEach(el => el.addEventListener("change", updateFastPlan));

  function syncFastAlarms() {
    state.alarms = state.alarms.filter(a => !a.system);
    if (!state.fast.remind) return;
    const s = toMin(state.fast.start);
    let span = toMin(state.fast.end) - s; if (span <= 0) span += 1440;
    const endDay = (s + span) >= 1440 ? (state.fast.day + 1) % 7 : state.fast.day;
    const midM = s + span / 2, midDay = midM >= 1440 ? (state.fast.day + 1) % 7 : state.fast.day;
    state.alarms.push(
      { id: "fast-start", system: true, label: "Fasting day begins — consecrate your day", time: state.fast.start, days: [state.fast.day], kind: "fast", enabled: true },
      { id: "fast-mid", system: true, label: "Midday prayer — keep going!", time: fromMin(Math.round(midM / 5) * 5), days: [midDay], kind: "fast", enabled: true },
      { id: "fast-end", system: true, label: "Time to give thanks and break your fast", time: state.fast.end, days: [endDay], kind: "fast", enabled: true }
    );
  }

  // live countdowns
  setInterval(() => {
    $$(".big-count[data-until]").forEach(el => {
      const ms = +el.dataset.until - Date.now();
      if (ms <= 0) { if (!$("#view-fast").hidden) render.fast(); }
      else el.textContent = countdown(ms);
    });
  }, 1000);

  /* ================= ALARMS ================= */
  $("#alarmDays").insertAdjacentHTML("beforeend", DAY_SHORT.map((d, i) =>
    `<label class="day-btn" title="${DAY_NAMES[i]}"><input type="checkbox" value="${i}" checked><span>${d}</span></label>`).join(""));

  function nextOccurrence(a, from = new Date()) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(from); d.setDate(d.getDate() + i);
      if (!a.days.includes(d.getDay())) continue;
      const t = at(d, a.time);
      if (t > from) return t;
    }
    return null;
  }
  function nextAlarm() {
    const cands = state.alarms.filter(a => a.enabled && a.days.length)
      .map(a => ({ label: a.label, when: nextOccurrence(a) }))
      .concat(state.snoozes.map(s => ({ label: s.label + " (snoozed)", when: new Date(s.at) })))
      .filter(c => c.when);
    cands.sort((a, b) => a.when - b.when);
    return cands[0] || null;
  }
  function daysText(days) {
    const s = [...days].sort().join();
    if (s === "0,1,2,3,4,5,6") return "Every day";
    if (s === "1,2,3,4,5") return "Weekdays";
    if (s === "0,6") return "Weekends";
    return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DAY_NAMES[d].slice(0, 3)).join(", ");
  }

  render.alarms = () => {
    renderPermission();
    const kindLabel = { prayer: "Prayer", study: "Study", fast: "Fasting" };
    const sorted = state.alarms.slice().sort((a, b) => toMin(a.time) - toMin(b.time));
    $("#alarmList").innerHTML = sorted.length ? sorted.map(a => `
      <li class="alarm${a.enabled ? "" : " off"}">
        <div>
          <div class="time">${fmtTime(a.time)}</div>
        </div>
        <div class="actions">
          ${a.system ? "" : `<button class="icon-btn" data-del="${a.id}" aria-label="Delete ${escapeHtml(a.label)}" style="font-size:1rem">🗑</button>`}
          <label class="toggle" title="On/off"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""} aria-label="Enable ${escapeHtml(a.label)}"><span></span></label>
        </div>
        <div class="meta"><strong style="color:var(--ink)">${escapeHtml(a.label)}</strong>
          <span class="tag">${a.system ? "Fasting plan" : kindLabel[a.kind]}</span><br>${daysText(a.days)}</div>
      </li>`).join("")
      : `<li class="card muted">No reminders yet — add one below.</li>`;
  };
  $("#alarmList").addEventListener("change", e => {
    const t = e.target.closest("[data-toggle]"); if (!t) return;
    const a = state.alarms.find(x => x.id === t.dataset.toggle);
    a.enabled = t.checked; save(); render.alarms();
  });
  $("#alarmList").addEventListener("click", e => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    const a = state.alarms.find(x => x.id === d.dataset.del);
    if (confirm(`Delete “${a.label}”?`)) { state.alarms = state.alarms.filter(x => x !== a); save(); render.alarms(); }
  });
  $("#alarmForm").addEventListener("submit", e => {
    e.preventDefault();
    const days = $$("#alarmDays input:checked").map(i => +i.value);
    if (!days.length) { toast("Pick at least one day"); return; }
    state.alarms.push({
      id: "a-" + Date.now().toString(36), label: $("#alarmLabel").value.trim() || "Reminder",
      time: $("#alarmTime").value, days, kind: $("#alarmKind").value, enabled: true
    });
    save();
    $("#alarmLabel").value = "";
    $("#newAlarmBox").open = false;
    render.alarms();
    toast("Reminder saved");
    if (permission === "prompt") requestNotif();
  });

  // Notification permission: "granted" | "denied" | "prompt" | "unsupported"
  let permission = NATIVE ? "prompt" : !("Notification" in window) ? "unsupported"
    : Notification.permission === "default" ? "prompt" : Notification.permission;
  // Android 12+: "Alarms & reminders" access lets reminders ring on the exact minute (otherwise Android may delay them).
  let exactAlarms = "granted";
  async function refreshPermission() {
    if (!NATIVE) return;
    try {
      const p = (await LN.checkPermissions()).display;
      permission = p.startsWith("prompt") ? "prompt" : p;
    } catch (e) { permission = "unsupported"; }
    try { exactAlarms = (await LN.checkExactNotificationSetting()).exact_alarm; } catch (e) { exactAlarms = "granted"; }
  }
  $("#allowExact").addEventListener("click", async () => {
    try { exactAlarms = (await LN.changeExactNotificationSetting()).exact_alarm; } catch (e) { /* settings screen unavailable */ }
    await refreshPermission();
    syncNativeAlarms();
    renderPermission();
  });
  function renderPermission() {
    const txt = $("#permissionText"), btn = $("#enableNotif");
    $("#exportIcs").hidden = NATIVE;
    $("#alarmHelp").textContent = NATIVE
      ? "Reminders ring on your phone at the set time, even when Lamp & Light is closed or the phone is locked."
      : "In-app alarms ring while Lamp & Light is open (it can be in the background). To be alerted even when the app is closed, use “Add to phone calendar” — it creates repeating calendar alarms.";
    if (permission === "unsupported") { txt.textContent = "This browser doesn't support notifications. In-app alarms will still ring."; btn.hidden = true; return; }
    txt.textContent = permission === "granted" ? "On — you'll get a notification and an alarm sound."
      : permission === "denied" ? (NATIVE ? "Blocked — allow notifications for Lamp & Light in your phone's Settings › Apps." : "Blocked — allow notifications for this site in your browser settings.")
      : "Off — turn on to be alerted for prayer, study and fasting.";
    btn.hidden = permission !== "prompt";
    $("#exactPrompt").hidden = !(NATIVE && permission === "granted" && exactAlarms !== "granted");
  }
  async function requestNotif() {
    unlockAudio();
    if (NATIVE) {
      try {
        const p = (await LN.requestPermissions()).display;
        permission = p.startsWith("prompt") ? "prompt" : p;
      } catch (e) { permission = "unsupported"; }
      if (permission === "granted") syncNativeAlarms();
    } else {
      if (!("Notification" in window)) return;
      const p = await Notification.requestPermission();
      permission = p === "default" ? "prompt" : p;
    }
    toast(permission === "granted" ? "Notifications enabled" : "Notifications not enabled");
    if (!$("#view-alarms").hidden) renderPermission();
    if (!$("#view-today").hidden) render.today();
  }
  $("#enableNotif").addEventListener("click", requestNotif);
  $("#enableNotifInline").addEventListener("click", requestNotif);
  $("#testAlarm").addEventListener("click", async () => {
    unlockAudio();
    if (!NATIVE) { ring({ id: "test", label: "Test alarm — time to pray", kind: "prayer" }); return; }
    if (permission !== "granted") { await requestNotif(); if (permission !== "granted") return; }
    const v = alarmVerse("prayer");
    await LN.schedule({ notifications: [{
      id: 2999999, title: "Test alarm — time to pray", body: `${v.ref} — ${v.text}`, largeBody: `“${v.text}” — ${v.ref}`,
      channelId: "alarms", smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
      schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true }, extra: { kind: "prayer", id: "test" }
    }] });
    toast("Test alarm in 10 seconds — you can close the app");
  });

  /* ----- Android: schedule reminders with the system so they ring when the app is closed ----- */
  const hashId = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 190000; };
  let nativeSyncTimer = null;
  function syncNativeAlarms() {
    if (!NATIVE) return;
    clearTimeout(nativeSyncTimer);
    nativeSyncTimer = setTimeout(async () => {
      try {
        if (permission !== "granted") return;
        const pending = (await LN.getPending()).notifications;
        if (pending.length) await LN.cancel({ notifications: pending.map(n => ({ id: n.id })) });
        const list = [];
        for (const a of state.alarms) {
          if (!a.enabled) continue;
          const [hour, minute] = a.time.split(":").map(Number);
          const v = alarmVerse(a.kind);
          for (const d of a.days) {
            list.push({
              id: hashId(a.id) * 10 + d, title: a.label, body: `${v.ref} — ${v.text}`, largeBody: `“${v.text}” — ${v.ref}`,
              channelId: "alarms", smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
              schedule: { on: { weekday: d + 1, hour, minute }, allowWhileIdle: true },
              extra: { kind: a.kind, id: a.id }
            });
          }
        }
        state.snoozes.filter(s => s.at > Date.now()).forEach((s, i) => list.push({
          id: 2000000 + i, title: s.label, body: "Snoozed reminder", channelId: "alarms", smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
          schedule: { at: new Date(s.at), allowWhileIdle: true }, extra: { kind: s.kind, id: s.id }
        }));
        if (list.length) await LN.schedule({ notifications: list });
      } catch (e) { console.warn("Could not schedule reminders", e); }
    }, 400);
  }

  // sound
  let audioCtx = null, chimeTimer = null, ringStopTimer = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* no audio */ }
  }
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  function chime() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.28 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 1.4);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 1.5);
    });
  }

  const ALARM_VERSES = { prayer: ["Matthew 6:6", "1 Thessalonians 5:16-18", "Philippians 4:6-7"], study: ["Psalms 119:105", "2 Timothy 3:16-17", "Joshua 1:9"], fast: ["Isaiah 58:6", "Joel 2:12", "Matthew 6:33"] };
  function alarmVerse(kind) {
    const refs = ALARM_VERSES[kind] || ALARM_VERSES.prayer;
    const pick = refs[Math.floor(Math.random() * refs.length)];
    return VERSES.find(x => x.ref === pick) || VERSES[0];
  }
  let ringing = null;
  // silent: the phone already played the notification sound (Android), so only show the alarm screen.
  async function ring(a, silent = false) {
    ringing = a;
    const v = alarmVerse(a.kind);
    $("#ringLabel").textContent = a.label;
    $("#ringTime").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("#ringVerse").textContent = `“${v.text}” — ${v.ref}`;
    const dlg = $("#alarmRing");
    if (!dlg.open) dlg.showModal();
    if (silent) return;

    unlockAudio(); chime();
    clearInterval(chimeTimer); chimeTimer = setInterval(chime, 2600);
    clearTimeout(ringStopTimer); ringStopTimer = setTimeout(stopRing, 90000);
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);

    if (!NATIVE && permission === "granted") {
      const opts = { body: `${v.ref} — ${v.text}`, icon: "icon.svg", badge: "icon.svg", tag: "alarm-" + a.id, requireInteraction: true, renotify: true };
      try {
        const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
        if (reg) await reg.showNotification(a.label, opts);
        else new Notification(a.label, opts);
      } catch (e) { try { new Notification(a.label, opts); } catch (_) { /* ignore */ } }
    }
  }
  function stopRing() {
    clearInterval(chimeTimer); clearTimeout(ringStopTimer);
    const dlg = $("#alarmRing"); if (dlg.open) dlg.close();
    ringing = null;
  }
  $("#ringStop").addEventListener("click", () => {
    const kind = ringing?.kind;
    stopRing();
    if (kind === "fast") show("fast"); else if (kind === "study") show("study");
  });
  $("#ringSnooze").addEventListener("click", () => {
    if (ringing && ringing.id !== "test") {
      state.snoozes.push({ id: ringing.id, label: ringing.label, kind: ringing.kind, at: Date.now() + 5 * 60000 });
      save(); toast("Snoozed for 5 minutes");
    }
    stopRing();
  });
  $("#alarmRing").addEventListener("cancel", stopRing);

  function checkAlarms() {
    const now = new Date(), nowMs = now.getTime();
    let changed = false;
    if (NATIVE) {  // Android delivers alarms itself; just tidy up expired snoozes
      const left = state.snoozes.filter(s => s.at > nowMs);
      if (left.length !== state.snoozes.length) { state.snoozes = left; save(); }
      return;
    }
    for (const a of state.alarms) {
      if (!a.enabled || !a.days.includes(now.getDay())) continue;
      const t = at(now, a.time).getTime();
      const stamp = `${dateKey(now)} ${a.time}`;
      // fire within a 3-minute window (background tabs may tick slowly)
      if (nowMs >= t && nowMs - t < 3 * 60000 && state.fired[a.id] !== stamp) {
        state.fired[a.id] = stamp; changed = true;
        ring(a);
      }
    }
    const due = state.snoozes.filter(s => s.at <= nowMs);
    if (due.length) {
      state.snoozes = state.snoozes.filter(s => s.at > nowMs); changed = true;
      due.filter(s => nowMs - s.at < 30 * 60000).forEach(s => ring(s));
    }
    if (changed) save();
  }
  setInterval(checkAlarms, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkAlarms(); const v = location.hash.slice(1) || "today"; if (v === "today") render.today(); } });

  // calendar export — repeating events with alarms that work even when the app is closed
  $("#exportIcs").addEventListener("click", () => {
    const active = state.alarms.filter(a => a.enabled && a.days.length);
    if (!active.length) { toast("No active reminders to export"); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const fmtLocal = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const esc = s => s.replace(/[\\;,]/g, m => "\\" + m);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lamp and Light//Bible Study Guide//EN", "CALSCALE:GREGORIAN"];
    for (const a of active) {
      const first = nextOccurrence(a, new Date(Date.now() - 864e5)) || at(new Date(), a.time);
      const end = new Date(first.getTime() + 15 * 60000);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${a.id}-${stamp}@lamp-and-light`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${fmtLocal(first)}`,
        `DTEND:${fmtLocal(end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${a.days.map(d => ICS_DAYS[d]).join(",")}`,
        `SUMMARY:${esc(a.label)}`,
        "DESCRIPTION:Reminder from Lamp & Light Bible Study Guide",
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(a.label)}`, "TRIGGER:PT0M", "END:VALARM",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: "lamp-and-light-reminders.ics" });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Open the downloaded file to add reminders to your calendar");
  });

  /* ================= SETTINGS ================= */
  function applySettings() {
    const root = document.documentElement;
    if (state.theme === "system") root.removeAttribute("data-theme"); else root.dataset.theme = state.theme;
    root.style.setProperty("--reader-size", state.font + "px");
    if (SystemBars) {
      const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      SystemBars.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
    }
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
  const settings = $("#settings");
  $("#openSettings").addEventListener("click", () => {
    $("#setTranslation").value = state.translation;
    $("#setTheme").value = state.theme;
    $("#setFont").value = state.font;
    $("#setName").value = state.name;
    settings.returnValue = "";
    settings.showModal();
  });
  $("#shareApp").addEventListener("click", () =>
    copyText("Lamp & Light — a free Bible study, fasting & prayer app: https://godson730.github.io/lamp-and-light/"));
  $("#setTheme").addEventListener("change", e => { state.theme = e.target.value; applySettings(); save(); });
  $("#setFont").addEventListener("input", e => { state.font = +e.target.value; applySettings(); save(); });
  $("#setName").addEventListener("input", e => { state.name = e.target.value.trim(); save(); });
  $("#setTranslation").addEventListener("change", e => { state.translation = e.target.value; save(); });
  settings.addEventListener("close", () => {
    if (settings.returnValue === "reset") {
      if (confirm("This erases your notes, highlights, fasting history and reminders on this device. Continue?")) {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
        location.reload();
      }
      return;
    }
    show(location.hash.slice(1) || "today");
  });

  /* ================= boot ================= */
  if (!state.alarms.some(a => a.system) && state.fast.remind) syncFastAlarms();
  applySettings();
  save();
  show(location.hash.slice(1) || "today");
  checkAlarms();
  setInterval(() => { if (!$("#view-today").hidden) render.today(); }, 60000);

  if (NATIVE) {
    (async () => {
      try {
        await LN.createChannel({
          id: "alarms", name: "Prayer, study & fasting alarms",
          description: "Your Lamp & Light reminders", importance: 4, visibility: 1, vibration: true, lights: true, lightColor: "#A87A26"
        });
      } catch (e) { /* channels need Android 8+ */ }
      await refreshPermission();
      if (permission === "prompt") await requestNotif(); else syncNativeAlarms();
      if (!$("#view-today").hidden) render.today();
    })();

    // Tapping a notification opens the matching screen
    LN.addListener("localNotificationActionPerformed", e => {
      const kind = e.notification?.extra?.kind;
      stopRing();
      show(kind === "fast" ? "fast" : kind === "study" ? "study" : "today");
    });
    // An alarm going off while the app is open shows the alarm screen
    LN.addListener("localNotificationReceived", n => {
      ring({ id: n.extra?.id || "notification", label: n.title, kind: n.extra?.kind || "prayer" }, true);
    });
    // Android back button: close dialogs, then go to Today, then leave the app
    AppPlugin.addListener("backButton", () => {
      const open = $$("dialog[open]");
      if (open.length) { open.forEach(d => (d.id === "alarmRing" ? stopRing() : d.close("close"))); return; }
      if ((location.hash.slice(1) || "today") !== "today") show("today");
      else AppPlugin.exitApp();
    });
    AppPlugin.addListener("resume", async () => {
      const before = permission + exactAlarms;
      await refreshPermission();
      if (permission + exactAlarms !== before) syncNativeAlarms();   // e.g. user changed access in Settings
      const v = location.hash.slice(1) || "today";
      if (v === "today" || v === "alarms" || v === "fast") render[v]();  // don't reset the Bible/Study scroll position
    });
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
