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
  const TTS = NATIVE ? Cap.registerPlugin("TextToSpeech") : null;   // Android: phone's speech engine
  const webSpeech = !NATIVE && "speechSynthesis" in window ? window.speechSynthesis : null;

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
    plan: null,              // active reading plan, see READING PLAN section
    tone: "chime",           // default alarm sound; each reminder may override it
    audio: { rate: 1, voice: "", continue: true },   // read-aloud settings
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
    checkNativeSync();
  }
  // Reschedule phone reminders whenever reminders, snoozes, reading progress or the date change
  function checkNativeSync() {
    if (!NATIVE) return;
    const p = state.plan;
    const sig = JSON.stringify([state.alarms, state.snoozes, p && [p.id, p.book, p.perDay, p.from, p.start, p.done], dateKey(new Date())]);
    if (sig !== alarmSignature) { alarmSignature = sig; syncNativeAlarms(); }
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

  /* ----- alarm tones ----- */
  // Android needs one notification channel per sound, so each tone has its own channel id.
  const TONES = [
    { id: "chime", name: "Chime", file: "sounds/chime.wav" },
    { id: "bells", name: "Church bells", file: "sounds/bells.wav" },
    { id: "harp", name: "Harp", file: "sounds/harp.wav" },
    { id: "morning", name: "Morning", file: "sounds/morning.wav" },
    { id: "alert", name: "Alert", file: "sounds/alert.wav" },
    { id: "default", name: "Phone's default sound", file: null },
    { id: "silent", name: "Silent (vibration only)", file: null, silence: true }
  ];
  const toneById = id => TONES.find(t => t.id === id) || TONES[0];
  const toneFor = a => toneById(a?.sound || state.tone || "chime").id;
  const channelFor = tone => `alarm_${tone}_v1`;
  const toneName = id => toneById(id).name;

  let tonePlayer = null;
  function playTone(id, { loop = false } = {}) {
    stopTone();
    const tone = toneById(id);
    if (tone.id === "silent") return true;
    if (!tone.file) return false;                 // "phone's default": no file to play in-app
    try {
      tonePlayer = new Audio(tone.file);
      tonePlayer.loop = loop;
      tonePlayer.volume = 1;
      tonePlayer.play().catch(() => { tonePlayer = null; });
      return true;
    } catch (e) { tonePlayer = null; return false; }
  }
  function stopTone() {
    if (!tonePlayer) return;
    try { tonePlayer.pause(); tonePlayer.currentTime = 0; } catch (e) { /* ignore */ }
    tonePlayer = null;
  }
  const toneOptions = (selected, includeDefault) =>
    (includeDefault ? `<option value="">Default (${escapeHtml(toneName(state.tone || "chime"))})</option>` : "") +
    TONES.map(t => `<option value="${t.id}" ${selected === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");


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
  const VIEWS = ["today", "bible", "groups", "study", "fast", "alarms", "plan"];
  function show(view) {
    if (!VIEWS.includes(view)) view = "today";
    $$(".view").forEach(v => { v.hidden = v.dataset.view !== view; });
    $$(".tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === (view === "plan" ? "today" : view)));
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
  window.addEventListener("hashchange", () => { if (!checkJoinHash()) show(location.hash.slice(1)); });

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

    renderTodayPlan();
  };
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
      renderPlanBar();
      if (player.active) setSpeakingVerse(player.idx); else updatePlayer();
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
    } else if (action === "share") { shareVerse(ref, text); return; }
    else if (action === "commentary") { showVerseNote(state.last.book, state.last.chapter, +ref.split(":")[1]); return; }
    else if (action === "listen") {
      const n = +ref.split(":")[1];
      startListening(state.last.book, state.last.chapter, Math.max(0, currentVerses.findIndex(v => v.n === n)));
      return;
    }
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

  /* ================= AUDIO BIBLE (read aloud) ================= */
  // Uses the phone's text-to-speech engine (Android) or the browser's speech synthesis. Verses are spoken one at a
  // time so the current verse can be highlighted; "pause" stops the engine and resumes from the same verse.
  const audioSupported = !!(TTS || webSpeech);
  const RATES = [0.75, 1, 1.25, 1.5];
  const player = { active: false, playing: false, book: null, chapter: 0, verses: [], idx: 0, token: 0 };
  let ttsLang = "en-US", voiceList = [];

  const speakable = t => t.replace(/\bLORD\b/g, "Lord").replace(/\bGOD\b/g, "God").replace(/\bJEHOVAH\b/g, "Jehovah");
  const chapterIntro = (book, ch) => book === "Psalms" ? `Psalm ${ch}.` : `${book}, chapter ${ch}.`;

  async function loadVoices() {
    try {
      if (TTS) {
        voiceList = (await TTS.getSupportedVoices()).voices.map((v, i) => ({ ...v, index: i }));
        const langs = (await TTS.getSupportedLanguages()).languages;
        ttsLang = langs.find(l => l === "en-US") || langs.find(l => /^en[-_]/i.test(l)) || "en-US";
      } else if (webSpeech) {
        voiceList = webSpeech.getVoices().map((v, i) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, index: i, localService: v.localService }));
      }
    } catch (e) { voiceList = []; }
    return voiceList;
  }
  if (webSpeech) webSpeech.addEventListener?.("voiceschanged", () => loadVoices());

  async function engineStop() {
    try {
      if (TTS) await TTS.stop();
      else if (webSpeech) webSpeech.cancel();
    } catch (e) { /* nothing to stop */ }
  }

  async function startListening(book, chapter, fromIdx = 0) {
    if (!audioSupported) { toast("Read-aloud isn't available on this device"); return; }
    try {
      const data = await fetchPassage(`${book} ${chapter}`);
      player.book = book; player.chapter = chapter;
      player.verses = data.verses.map(v => ({ n: v.verse, text: v.text }));
    } catch (e) { toast("Couldn't open that chapter"); return; }
    player.active = true;
    playFrom(Math.max(0, Math.min(fromIdx, player.verses.length - 1)), fromIdx === 0);
  }

  async function playFrom(idx, withIntro = false) {
    const token = ++player.token;
    await engineStop();
    if (token !== player.token) return;
    player.playing = true; player.idx = idx;
    const items = [];
    if (withIntro) items.push({ text: chapterIntro(player.book, player.chapter), idx });
    for (let i = idx; i < player.verses.length; i++) items.push({ text: speakable(player.verses[i].text), idx: i });
    setSpeakingVerse(idx);
    const rate = state.audio.rate || 1;
    if (TTS) {
      if (!voiceList.length) await loadVoices();
      const voice = voiceList.find(v => v.voiceURI === state.audio.voice);
      // Queue every verse at once; each promise resolves when that verse has been spoken
      items.forEach((it, k) => {
        TTS.speak({ text: it.text, lang: voice?.lang || ttsLang, rate, voice: voice ? voice.index : undefined, queueStrategy: 1 })
          .then(() => {
            if (token !== player.token) return;
            if (k + 1 < items.length) setSpeakingVerse(items[k + 1].idx);
            else chapterFinished(token);
          })
          .catch(err => {
            if (token !== player.token) return;
            console.warn("Speech failed", err);
            player.playing = false; updatePlayer();
            toast("The phone's voice couldn't read this. Check Settings › Text-to-speech on your phone.");
          });
      });
    } else {
      const voices = webSpeech.getVoices();
      const voice = voices.find(v => v.voiceURI === state.audio.voice);
      // Browsers with no working voice "finish" each verse instantly; detect that instead of racing through the Bible
      let instantEnds = 0;
      const speakItem = k => {
        if (token !== player.token) return;
        if (k >= items.length) { chapterFinished(token); return; }
        const u = new SpeechSynthesisUtterance(items[k].text);
        u.rate = rate; u.lang = voice?.lang || "en-US"; if (voice) u.voice = voice;
        let startedAt = Date.now();
        u.onstart = () => { startedAt = Date.now(); if (token === player.token) setSpeakingVerse(items[k].idx); };
        u.onend = () => {
          if (token !== player.token) return;
          const tooFast = items[k].text.length > 25 && Date.now() - startedAt < 120;
          instantEnds = tooFast ? instantEnds + 1 : 0;
          if (instantEnds >= 3) {
            stopListening(false);
            toast("No reading voice is available in this browser. Try another browser, or install a voice in your device settings.");
            return;
          }
          speakItem(k + 1);
        };
        u.onerror = e => { if (token === player.token && e.error !== "interrupted" && e.error !== "canceled") speakItem(k + 1); };
        webSpeech.speak(u);
      };
      setTimeout(() => speakItem(0), 60);   // Chrome needs a moment after cancel()
    }
    updatePlayer();
  }

  async function chapterFinished(token) {
    if (token !== player.token) return;
    const { book, chapter } = player;
    const b = BOOKS.findIndex(x => x.name === book);
    // Inside a reading-plan passage, stop at the end of the passage so it can be marked as read
    const plan = planDef();
    let planEnd = false;
    if (plan) {
      const f = planStats(plan).focus;
      const seg = f && plan.days[f - 1].find(([sb, c1, c2]) => sb === b && chapter >= c1 && chapter <= c2);
      if (seg && chapter === seg[2]) planEnd = true;
    }
    let next = null;
    if (chapter < BOOKS[b].chapters) next = [book, chapter + 1];
    else if (b + 1 < BOOKS.length) next = [BOOKS[b + 1].name, 1];
    if (!state.audio.continue || planEnd || !next) {
      stopListening(false);
      toast(planEnd ? "Today's reading is finished. Tap “Mark as read ✓”." : `Finished ${book} ${chapter}`);
      return;
    }
    // Follow along: move the reader to the next chapter too
    const following = state.last.book === book && state.last.chapter === chapter;
    if (following) {
      state.last = { book: next[0], chapter: next[1] }; save();
      if (!$("#view-bible").hidden) goChapter(next[0], next[1]);
    }
    await startListening(next[0], next[1], 0);
  }

  function stopListening(hide = true) {
    player.token++;
    engineStop();
    player.playing = false;
    if (hide) player.active = false;
    setSpeakingVerse(null);
    updatePlayer();
  }
  function pauseListening() {
    player.token++;
    engineStop();
    player.playing = false;
    updatePlayer();
  }

  function setSpeakingVerse(idx) {
    if (idx != null) player.idx = idx;
    $$("#reader .verse.speaking").forEach(el => el.classList.remove("speaking"));
    if (idx != null && player.active && state.last.book === player.book && state.last.chapter === player.chapter) {
      const n = player.verses[idx]?.n;
      const el = n && $(`#reader [data-verse="${n}"]`);
      if (el) {
        el.classList.add("speaking");
        // Keep the spoken verse on screen, but don't fight the reader if it's already visible
        const r = el.getBoundingClientRect();
        if (!$("#view-bible").hidden && (r.top < 90 || r.bottom > innerHeight - 150)) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    updatePlayer();
  }

  function updatePlayer() {
    const bar = $("#player");
    bar.hidden = !player.active;
    document.body.classList.toggle("has-player", player.active);
    $("#listenChapter").textContent = player.active && player.playing && state.last.book === player.book && state.last.chapter === player.chapter
      ? "⏸ Pause reading" : "🔊 Listen to this chapter";
    if (!player.active) return;
    $("#plTitle").textContent = `${player.book} ${player.chapter}`;
    const v = player.verses[player.idx];
    $("#plVerse").textContent = v ? `${player.playing ? "Reading" : "Paused at"} verse ${v.n}` : "";
    $("#plPlay").textContent = player.playing ? "⏸" : "▶";
    $("#plPlay").setAttribute("aria-label", player.playing ? "Pause" : "Play");
    $("#plRate").textContent = `${state.audio.rate || 1}×`;
  }

  $("#plPlay").addEventListener("click", () => player.playing ? pauseListening() : playFrom(player.idx));
  $("#plPrev").addEventListener("click", () => playFrom(Math.max(0, player.idx - 1)));
  $("#plNext").addEventListener("click", () => {
    if (player.idx + 1 < player.verses.length) playFrom(player.idx + 1);
    else chapterFinished(player.token);
  });
  $("#plClose").addEventListener("click", () => stopListening(true));
  $("#plRate").addEventListener("click", () => {
    const i = RATES.indexOf(state.audio.rate || 1);
    state.audio.rate = RATES[(i + 1) % RATES.length]; save();
    if (player.playing) playFrom(player.idx); else updatePlayer();
    toast(`Reading speed ${state.audio.rate}×`);
  });
  $("#plInfo").addEventListener("click", () => {
    pendingFocus = { from: player.verses[player.idx]?.n || 1, to: player.verses[player.idx]?.n || 1 };
    state.last = { book: player.book, chapter: player.chapter }; save();
    if ($("#view-bible").hidden) show("bible"); else goChapter(player.book, player.chapter);
  });
  $("#listenChapter").addEventListener("click", () => {
    const { book, chapter } = state.last;
    if (player.active && player.book === book && player.chapter === chapter) {
      if (player.playing) pauseListening(); else playFrom(player.idx);
    } else {
      startListening(book, chapter, 0);
    }
  });
  if (audioSupported) { $("#listenChapter").hidden = false; $("#verseListenBtn").hidden = false; }

  /* ================= READING PLAN ================= */
  // state.plan = { id, start: "YYYY-MM-DD", done: { "<day>": [bool per reading] }, current: { day, i } }
  // A plan is either one of PLANS, or a book the user picked: { id: "book", book, perDay, from }
  let bookPlanCache = null;
  function planDef() {
    if (!state.plan) return null;
    if (state.plan.id !== "book") return PLANS.find(p => p.id === state.plan.id) || null;
    const { book, perDay = 1, from = 1 } = state.plan;
    const key = `${book}:${perDay}:${from}`;
    if (bookPlanCache?.key === key) return bookPlanCache.plan;
    const plan = buildBookPlan(book, perDay, from);
    bookPlanCache = plan ? { key, plan } : null;
    return plan;
  }
  function buildBookPlan(book, perDay, from) {
    const b = BOOKS[book];
    if (!b || from < 1 || from > b.chapters) return null;
    const days = [];
    for (let c = from; c <= b.chapters; c += perDay) days.push([[book, c, Math.min(c + perDay - 1, b.chapters)]]);
    const words = CHAPTER_WORDS[book].slice(from - 1).reduce((sum, w) => sum + w, 0);
    return {
      id: "book",
      title: `${b.name}, ${perDay === 1 ? "a chapter" : `${perDay} chapters`} a day`,
      description: `Read ${b.name} from chapter ${from}.`,
      minutes: Math.max(2, Math.round(words / days.length / 200)),
      days
    };
  }
  const segLabel = ([b, c1, c2]) => `${BOOKS[b].name} ${c1 === c2 ? c1 : `${c1}–${c2}`}`;
  const dayLabel = readings => readings.map(segLabel).join(" · ");
  function parseDate(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
  function planToday() {                       // which plan day the calendar says it is (1-based)
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(1, Math.round((today - parseDate(state.plan.start)) / 864e5) + 1);
  }
  const isRead = (day, i) => !!state.plan.done[day]?.[i];
  const dayComplete = (plan, day) => plan.days[day - 1].every((_, i) => isRead(day, i));
  function planStats(plan) {
    const today = Math.min(planToday(), plan.days.length);
    let completed = 0, firstUnread = null, behind = 0;
    const joinDay = state.plan.joinDay || 1;   // joined a friend mid-plan: earlier days are skipped
    plan.days.forEach((_, idx) => {
      const day = idx + 1;
      if (day < joinDay || dayComplete(plan, day)) completed++;
      else {
        if (firstUnread == null) firstUnread = day;
        if (day < today) behind++;
      }
    });
    // The day to read now: the earliest unfinished day, or today's if you're up to date
    const focus = firstUnread == null ? null : firstUnread;
    return { today, completed, behind, focus, finished: firstUnread == null };
  }
  function setRead(day, i, value) {
    const plan = planDef();
    const arr = state.plan.done[day] || (state.plan.done[day] = plan.days[day - 1].map(() => false));
    arr[i] = value;
    if (arr.every(v => !v)) delete state.plan.done[day];
    save();
    // lets groups following the same plan tick this reader off
    window.dispatchEvent(new CustomEvent("ll:read", { detail: { day, complete: dayComplete(plan, day) } }));
  }
  function openReading(day, i) {
    const [b, c1] = planDef().days[day - 1][i];
    state.plan.current = { day, i };
    save();
    openRef(`${BOOKS[b].name} ${c1}`);
  }
  function wireBookPlanForm() {
    const bookSel = $("#bpBook"), perDaySel = $("#bpPerDay"), fromSel = $("#bpFrom");
    const remind = $("#bpRemind"), time = $("#bpTime");
    const fillFrom = () => {
      const b = BOOKS[+bookSel.value];
      const keep = Math.min(+fromSel.value || 1, b.chapters);
      fromSel.innerHTML = Array.from({ length: b.chapters }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
      fromSel.value = keep;
    };
    const summary = () => {
      const p = buildBookPlan(+bookSel.value, +perDaySel.value, +fromSel.value);
      $("#bpSummary").textContent = `${p.days.length} ${p.days.length === 1 ? "day" : "days"} · about ${p.minutes} min a day · today: ${dayLabel(p.days[0])}` +
        (remind.checked ? ` · reminder at ${fmtTime(time.value || "07:00")}` : "");
    };
    bookSel.addEventListener("change", () => { fromSel.value = 1; fillFrom(); summary(); });
    [perDaySel, fromSel, remind, time].forEach(el => el.addEventListener("change", summary));
    remind.addEventListener("change", () => { time.disabled = !remind.checked; });
    fillFrom(); summary();
    $("#bpStart").addEventListener("click", () => {
      const book = +bookSel.value, perDay = +perDaySel.value, from = +fromSel.value;
      state.plan = { id: "book", book, perDay, from, start: dateKey(new Date()), done: {}, current: null };
      if (remind.checked) {
        const existing = state.alarms.find(a => a.id === "a-reading");
        const t = time.value || "07:00";
        if (existing) Object.assign(existing, { time: t, enabled: true, days: [0, 1, 2, 3, 4, 5, 6] });
        else state.alarms.push({ id: "a-reading", label: "Daily Bible reading", time: t, days: [0, 1, 2, 3, 4, 5, 6], kind: "study", enabled: true });
      }
      save();
      toast(`Reading ${BOOKS[book].name}! Today: chapter ${from}${perDay > 1 ? `–${Math.min(from + perDay - 1, BOOKS[book].chapters)}` : ""}`);
      if (remind.checked && permission === "prompt") requestNotif();
      render.plan();
    });
  }

  // Upcoming reading reminders that name the chapter for each day (used for the "a-reading" alarm)
  function upcomingReadingReminders(alarm, horizonDays) {
    const plan = planDef();
    if (!plan) return null;
    const s = planStats(plan);
    if (s.finished) return null;
    const now = new Date(), todayNum = planToday(), out = [];
    let next = s.focus;
    for (let k = 0; k < horizonDays && next <= plan.days.length; k++) {
      const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + k);
      if (!alarm.days.includes(date.getDay())) continue;
      if (k === 0 && next > todayNum) continue;            // today's reading is already done
      const when = at(date, alarm.time);
      if (when <= now) { if (k === 0) next++; continue; }   // today's reminder already went off
      out.push({ at: when, day: next, label: dayLabel(plan.days[next - 1]), total: plan.days.length, title: plan.title });
      next++;
    }
    if (out.length && next <= plan.days.length) out[out.length - 1].last = true;   // reminders run out: nudge to reopen the app
    return out;
  }
  // What the reading reminder should say right now (in-app alarm), or null if today's reading is done
  function readingAlarmNow(alarm) {
    const plan = planDef();
    if (alarm.id !== "a-reading" || !plan) return alarm;
    const s = planStats(plan);
    if (s.finished) return alarm;
    if (s.focus > planToday()) return null;
    return { id: alarm.id, label: `📖 Today's reading: ${dayLabel(plan.days[s.focus - 1])}`, kind: "reading" };
  }
  function openNextReading() {
    const plan = planDef();
    if (!plan) { show("plan"); return; }
    const s = planStats(plan);
    if (s.finished) { show("plan"); return; }
    const i = plan.days[s.focus - 1].findIndex((_, k) => !isRead(s.focus, k));
    openReading(s.focus, Math.max(0, i));
  }

  function startPlan(id) {
    state.plan = { id, start: dateKey(new Date()), done: {}, current: null };
    save();
    toast("Reading plan started. Day 1 is ready!");
    render.plan();
  }
  function readingItems(plan, day) {
    return plan.days[day - 1].map((seg, i) => `
      <li class="${isRead(day, i) ? "read" : ""}">
        <label class="check"><input type="checkbox" data-read="${day}:${i}" ${isRead(day, i) ? "checked" : ""} aria-label="Mark ${segLabel(seg)} as read"><span></span></label>
        <button type="button" class="reading-link" data-open="${day}:${i}">${segLabel(seg)}</button>
      </li>`).join("");
  }

  function renderTodayPlan() {
    const card = $("#todayPlan"), plan = planDef();
    if (!plan) {
      card.innerHTML = `
        <p class="eyebrow">Daily Bible reading</p>
        <h2>Read the Bible every day</h2>
        <p class="muted">Choose any book to read a chapter a day, with a daily reminder of your chapter, or follow a plan like Bible in a Year.</p>
        <button class="btn" data-goto="plan">Choose a book or plan</button>`;
      return;
    }
    const s = planStats(plan);
    if (s.finished) {
      card.innerHTML = `<p class="eyebrow">Daily Bible reading</p><h2>${escapeHtml(plan.title)} complete! 🎉</h2>
        <p class="muted">Well done. You finished all ${plan.days.length} days.</p><button class="btn" data-goto="plan">Start another plan</button>`;
      return;
    }
    // If today's reading is already done, keep showing today (with a "read ahead" option) rather than tomorrow
    const aheadDay = s.focus > s.today ? s.focus : null;
    const day = aheadDay ? s.today : s.focus;
    const allRead = dayComplete(plan, day);
    const status = allRead ? `Done for today ✓` : day < s.today ? `Day ${day} · catching up` : `Day ${day} of ${plan.days.length}`;
    const firstUnread = plan.days[day - 1].findIndex((_, i) => !isRead(day, i));
    card.innerHTML = `
      <p class="eyebrow">Today's reading · ${escapeHtml(plan.title)}</p>
      <h2>${escapeHtml(status)}</h2>
      ${day < s.today ? `<p class="muted small">Today is day ${s.today}. Pick up where you left off.</p>` : ""}
      <ul class="reading-list">${readingItems(plan, day)}</ul>
      <div class="progress"><span style="width:${Math.round(s.completed / plan.days.length * 100)}%"></span></div>
      <div class="row between wrap">
        <span class="muted small">${s.completed} of ${plan.days.length} days done · about ${plan.minutes} min a day</span>
        <div class="row gap">
          <button class="btn ghost small" data-share-reading>Share</button>
          <button class="btn ghost small" data-goto="plan">Plan</button>
          ${allRead
            ? (aheadDay ? `<button class="btn ghost small" data-open="${aheadDay}:0">Read ahead</button>` : "")
            : `<button class="btn small" data-open="${day}:${firstUnread}">${firstUnread > 0 ? "Continue" : "Start reading"}</button>`}
        </div>
      </div>`;
  }

  let showAllDays = false;
  render.plan = () => {
    const body = $("#planBody"), plan = planDef();
    if (!plan) {
      const currentBook = Math.max(0, BOOKS.findIndex(b => b.name === state.last.book));
      body.innerHTML = `
        <h1>Choose what to read</h1>
        <p class="lead">Pick any book of the Bible to read day by day, or follow one of the plans below.</p>
        <article class="card plan-option book-plan">
          <h2>Read a book of your choice</h2>
          <p class="muted small">Read one book chapter by chapter. Your daily reminder tells you exactly which chapter is next.</p>
          <div class="form-grid">
            <label class="span-2">Book
              <select id="bpBook">${BOOKS.map((b, i) =>
                (i === 0 ? '<optgroup label="Old Testament">' : i === 39 ? '</optgroup><optgroup label="New Testament">' : "") +
                `<option value="${i}" ${i === currentBook ? "selected" : ""}>${b.name} (${b.chapters} ${b.chapters === 1 ? "chapter" : "chapters"})</option>`).join("")}</optgroup>
              </select>
            </label>
            <label>Chapters a day
              <select id="bpPerDay">${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join("")}</select>
            </label>
            <label>Start at chapter
              <select id="bpFrom"></select>
            </label>
          </div>
          <label class="switch-row reminder-row">
            <input type="checkbox" id="bpRemind" checked>
            <span>Remind me every day at</span>
            <input type="time" id="bpTime" value="${state.alarms.find(a => a.id === "a-reading")?.time || "07:00"}" aria-label="Reminder time">
          </label>
          <p class="notice small" id="bpSummary"></p>
          <button class="btn" id="bpStart">Start reading</button>
        </article>
        <article class="card join-code">
          <h2>Got an invite from a friend?</h2>
          <p class="muted small">Enter the invite code they sent you to read the same passages together.</p>
          <form class="search" id="joinCodeForm" autocomplete="off">
            <input id="joinCodeInput" placeholder="e.g. BY-260915" aria-label="Invite code" autocapitalize="characters">
            <button class="btn" type="submit">Join</button>
          </form>
        </article>
        <h2 class="section-title">Or follow a plan</h2>
        ${PLANS.map(p => `
          <article class="card plan-option">
            <div class="row between wrap">
              <div>
                <h2>${escapeHtml(p.title)}</h2>
                <p class="muted small">${p.days.length} days · about ${p.minutes} min a day</p>
              </div>
              <button class="btn" data-start-plan="${p.id}">Start</button>
            </div>
            <p>${escapeHtml(p.description)}</p>
            <p class="muted small">Day 1: ${escapeHtml(dayLabel(p.days[0]))}</p>
          </article>`).join("")}`;
      wireBookPlanForm();
      $("#joinCodeForm").addEventListener("submit", e => {
        e.preventDefault();
        const code = $("#joinCodeInput").value.trim();
        if (code) handleJoinCode(code);
      });
      return;
    }
    const s = planStats(plan);
    const pct = Math.round(s.completed / plan.days.length * 100);
    const reminder = state.alarms.find(a => a.id === "a-reading");
    let html = `
      <h1>${escapeHtml(plan.title)}</h1>
      <article class="card">
        <p class="big-number">${pct}%</p>
        <p class="muted small">${s.completed} of ${plan.days.length} days completed · started ${parseDate(state.plan.start).toLocaleDateString([], { month: "short", day: "numeric" })}</p>
        <div class="progress"><span style="width:${pct}%"></span></div>
        ${s.finished ? `<p><strong>You finished the plan! 🎉</strong> “Thy word is a lamp unto my feet, and a light unto my path.”</p>`
          : s.behind ? `<p class="notice small">You're ${s.behind} day${s.behind > 1 ? "s" : ""} behind. That's okay, just keep going.
              <button class="link" id="planCatchUp">Reset my schedule to start from today</button></p>`
          : `<p class="muted small">You're on track. Keep it up!</p>`}
      </article>`;
    if (!s.finished) {
      const day = s.focus;
      html += `
        <article class="card">
          <p class="eyebrow">${day === s.today ? "Today" : day < s.today ? "Next to read" : "Reading ahead"} · Day ${day}</p>
          <ul class="reading-list">${readingItems(plan, day)}</ul>
          <p class="muted small">Tap a reading to open it. Mark it read at the end of the chapter, or tick it here.</p>
        </article>
        <article class="card">
          <p class="eyebrow">Coming up</p>
          <ul class="day-list">${plan.days.slice(day, day + 5).map((d, k) => `
            <li><span class="day-num">Day ${day + k + 1}</span><span>${escapeHtml(dayLabel(d))}</span></li>`).join("") || `<li class="muted">This is the last day!</li>`}</ul>
        </article>`;
    }
    html += `
      <article class="card read-together">
        <p class="eyebrow">Read together</p>
        <p>Invite family, friends or your church group. Everyone who joins reads the same passage on the same day.</p>
        <p class="muted small">Invite code: <strong class="code">${planCode()}</strong></p>
        <div class="row gap wrap">
          <button class="btn" data-share-invite>Invite friends</button>
          <button class="btn ghost" data-share-reading>Share today's reading</button>
        </div>
      </article>
      <article class="card">
        <p class="eyebrow">Daily reminder</p>
        ${reminder
          ? `<p>Reminder set for <strong>${fmtTime(reminder.time)}</strong>${reminder.days.length === 7 ? " every day" : ""}${reminder.enabled ? "" : " (turned off)"}. It tells you which ${state.plan.id === "book" ? "chapter" : "passage"} to read that day.
             <button class="link" data-goto="alarms">Change in Alarms</button></p>`
          : `<div class="row gap wrap"><input type="time" id="planReminderTime" value="06:30" style="max-width:140px" aria-label="Reminder time">
             <button class="btn ghost" id="planReminderAdd">Remind me daily</button></div>`}
      </article>
      <details class="card" ${showAllDays ? "open" : ""} id="planAllDays">
        <summary>All ${plan.days.length} days</summary>
        <ul class="day-list all">${plan.days.map((d, idx) => {
          const n = idx + 1, done = dayComplete(plan, n);
          return `<li class="${done ? "read" : ""}${n === s.focus ? " focus" : ""}">
            <label class="check"><input type="checkbox" data-read-day="${n}" ${done ? "checked" : ""} aria-label="Mark day ${n} as read"><span></span></label>
            <span class="day-num">Day ${n}</span>
            <button type="button" class="reading-link" data-open="${n}:0">${escapeHtml(dayLabel(d))}</button></li>`;
        }).join("")}</ul>
      </details>
      <div class="row gap wrap">
        <button class="btn ghost danger small" id="planStop">Stop or change plan</button>
      </div>`;
    body.innerHTML = html;

    const catchUp = $("#planCatchUp");
    if (catchUp) catchUp.addEventListener("click", () => {
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (s.focus - 1));
      state.plan.start = dateKey(start); save();
      toast(`Schedule moved: day ${s.focus} is today`);
      render.plan();
    });
    const addRem = $("#planReminderAdd");
    if (addRem) addRem.addEventListener("click", () => {
      state.alarms.push({ id: "a-reading", label: "Daily Bible reading", time: $("#planReminderTime").value || "06:30", days: [0, 1, 2, 3, 4, 5, 6], kind: "study", enabled: true });
      save(); toast("Daily reading reminder added");
      if (permission === "prompt") requestNotif();
      render.plan();
    });
    $("#planAllDays").addEventListener("toggle", e => { showAllDays = e.target.open; });
    $("#planStop").addEventListener("click", () => {
      if (!confirm(`Stop “${plan.title}”? Your progress in this plan will be cleared.`)) return;
      state.plan = null; save(); render.plan();
    });
  };

  // Shared handlers for plan buttons and checkboxes (Today card, plan page)
  document.addEventListener("click", e => {
    const start = e.target.closest("[data-start-plan]");
    if (start) { startPlan(start.dataset.startPlan); return; }
    const open = e.target.closest("[data-open]");
    if (open && planDef()) { const [d, i] = open.dataset.open.split(":").map(Number); openReading(d, i); }
  });
  document.addEventListener("change", e => {
    const plan = planDef(); if (!plan) return;
    const r = e.target.closest("[data-read]"), rd = e.target.closest("[data-read-day]");
    if (r) { const [d, i] = r.dataset.read.split(":").map(Number); setRead(d, i, r.checked); }
    else if (rd) { const d = +rd.dataset.readDay; plan.days[d - 1].forEach((_, i) => setRead(d, i, rd.checked)); }
    else return;
    if (dayComplete(plan, r ? +r.dataset.read.split(":")[0] : +rd.dataset.readDay) && e.target.checked) toast("Day complete! 🎉");
    if (!$("#view-today").hidden) render.today();
    if (!$("#view-plan").hidden) render.plan();
  });

  // Bar under the Bible text while reading a plan passage: next chapter → mark as read → next reading
  function renderPlanBar() {
    const bar = $("#planBar"), plan = planDef();
    bar.hidden = true;
    if (!plan || planStats(plan).finished && !state.plan.current) return;
    const { book, chapter } = state.last;
    const b = BOOKS.findIndex(x => x.name === book);
    const inSeg = ([sb, c1, c2]) => sb === b && chapter >= c1 && chapter <= c2;
    // Prefer the reading opened from the plan; otherwise match the current unfinished day
    let day = null, i = -1;
    const cur = state.plan.current;
    if (cur && plan.days[cur.day - 1]?.[cur.i] && inSeg(plan.days[cur.day - 1][cur.i])) { day = cur.day; i = cur.i; }
    else {
      const f = planStats(plan).focus;
      if (f) { const k = plan.days[f - 1].findIndex(inSeg); if (k >= 0) { day = f; i = k; } }
    }
    if (day == null) return;
    const seg = plan.days[day - 1][i], [, c1, c2] = seg;
    const read = isRead(day, i);
    const nextIdx = plan.days[day - 1].findIndex((_, k) => !isRead(day, k) && k !== i);
    let actions;
    const listenBtn = audioSupported ? `<button class="btn ghost" id="planListen">🔊 Listen</button>` : "";
    if (!read && chapter < c2) {
      actions = `${listenBtn}<button class="btn" id="planNextChapter">Next chapter ›</button>`;
    } else if (!read) {
      actions = `${listenBtn}<button class="btn" id="planMarkRead">Mark as read ✓</button>`;
    } else if (nextIdx >= 0) {
      actions = `<span class="muted small">✓ Read.</span> <button class="btn" data-open="${day}:${nextIdx}">Next: ${escapeHtml(segLabel(plan.days[day - 1][nextIdx]))} ›</button>`;
    } else {
      actions = `<span><strong>Day ${day} complete! 🎉</strong></span> <button class="btn ghost" data-goto="plan">Back to plan</button>`;
    }
    bar.innerHTML = `
      <div>
        <p class="eyebrow">${escapeHtml(plan.title)} · Day ${day}</p>
        <p class="plan-bar-title">${escapeHtml(segLabel(seg))}${c1 !== c2 ? ` <span class="muted small">· chapter ${chapter - c1 + 1} of ${c2 - c1 + 1}</span>` : ""}</p>
      </div>
      <div class="row gap wrap">${actions}</div>`;
    bar.hidden = false;
    const listen = $("#planListen");
    if (listen) listen.addEventListener("click", () => startListening(book, chapter, 0));
    const next = $("#planNextChapter");
    if (next) next.addEventListener("click", () => goChapter(book, chapter + 1));
    const mark = $("#planMarkRead");
    if (mark) mark.addEventListener("click", () => {
      setRead(day, i, true);
      toast(dayComplete(plan, day) ? `Day ${day} complete! 🎉` : `${segLabel(seg)} marked as read`);
      renderPlanBar();
    });
  }

  /* ================= SHARING (WhatsApp, verse pictures, read together) ================= */
  const Share = NATIVE ? Cap.registerPlugin("Share") : null;
  const Filesystem = NATIVE ? Cap.registerPlugin("Filesystem") : null;
  const SITE = "https://godson730.github.io/lamp-and-light/";

  // Invite codes: plan + start date, e.g. "BY-260915" (Bible in a Year from 15 Sep 2026) or "B45X1C1-260915" (Romans, 1 a day, from ch. 1)
  const PLAN_CODES = { "bible-year": "BY", "bible-2-years": "B2", "nt-90": "NT", "gospels-30": "GO", "psalms-30": "PS", "proverbs-31": "PR" };
  function planCode(p = state.plan) {
    const key = p.id === "book" ? `B${p.book + 1}X${p.perDay || 1}C${p.from || 1}` : PLAN_CODES[p.id];
    return `${key}-${p.start.replace(/-/g, "").slice(2)}`;
  }
  function parsePlanCode(code) {
    const m = String(code || "").trim().toUpperCase().match(/^(?:(BY|B2|NT|GO|PS|PR)|B(\d{1,2})X([1-5])C(\d{1,3}))-(\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    const start = `20${m[5]}-${m[6]}-${m[7]}`;
    const d = parseDate(start);
    if (isNaN(d) || dateKey(d) !== start) return null;
    if (m[1]) return { id: Object.keys(PLAN_CODES).find(k => PLAN_CODES[k] === m[1]), start };
    const book = +m[2] - 1, perDay = +m[3], from = +m[4];
    if (!BOOKS[book] || from < 1 || from > BOOKS[book].chapters) return null;
    return { id: "book", book, perDay, from, start };
  }
  const inviteLink = () => `${SITE}join.html?c=${planCode()}`;

  async function shareViaApps(text) {
    if (Share) { try { await Share.share({ text, dialogTitle: "Share with…" }); } catch (e) { /* closed */ } return; }
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copyText(text);
  }
  function openWhatsApp(text) {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (NATIVE) location.href = url;          // Android hands this to the WhatsApp app
    else window.open(url, "_blank", "noopener");
  }

  /* ----- text for each kind of share (WhatsApp understands *bold* and _italic_) ----- */
  const trName = () => state.translation.toUpperCase();
  const verseShareText = (ref, text) => `“${text}”\n— *${ref}* (${trName()})\n\nShared from Lamp & Light 📖\n${SITE}`;
  function readingShareText() {
    const plan = planDef(); if (!plan) return "";
    const s = planStats(plan);
    const day = s.finished ? plan.days.length : Math.min(Math.max(s.focus, 1), plan.days.length);
    const q = DISCUSSION_QUESTIONS[(day - 1) % DISCUSSION_QUESTIONS.length];
    return `📖 *${plan.title} · Day ${day}*\nToday's reading: *${dayLabel(plan.days[day - 1])}*\n\n💬 _${q}_\n\nRead along with us on Lamp & Light 👇\n${inviteLink()}`;
  }
  function inviteShareText() {
    const plan = planDef(); if (!plan) return "";
    return `Let's read the Bible together! 🙏\nI'm reading *${plan.title}* (${plan.days.length} days) in the Lamp & Light app. Join me and we'll read the same passage each day:\n${inviteLink()}\n\nInvite code: *${planCode()}*`;
  }
  function fastShareText() {
    const f = fastInfo(), wk = f.week;
    const day = f.day.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    return `🕊 *Weekly Fasting & Prayer: ${wk.title}*\n${day} · ${fmtTime(state.fast.start)} – ${fmtTime(state.fast.end)}\n\n_${wk.focus}_\n\n*Scriptures:* ${wk.scriptures.join(" · ")}\n\n*Prayer points:*\n${wk.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nPray with us on Lamp & Light 📖\n${SITE}`;
  }
  function lessonShareText() {
    const i = selectedLesson ?? cycle(weekIndex(), LESSONS.length), l = LESSONS[i];
    return `✏️ *Bible Study: ${l.title}*\nRead: *${l.passage}*\n\n${l.summary}\n\n*Questions to discuss:*\n${l.questions.map((q, k) => `${k + 1}. ${q}`).join("\n")}\n\n*This week:* ${l.apply}\n\nStudy with us on Lamp & Light 📖\n${SITE}`;
  }

  /* ----- verse picture ----- */
  const CARD_STYLES = [
    { id: "burgundy", name: "Burgundy", bg: ["#9a5140", "#5c2a20"], ink: "#fffaf3", accent: "#f3c46b" },
    { id: "dawn", name: "Dawn", bg: ["#fbe3b8", "#e79b6d"], ink: "#3a1f14", accent: "#7a3b2e" },
    { id: "parchment", name: "Parchment", bg: ["#fdf9f1", "#eee0c8"], ink: "#2a221c", accent: "#8b4a33" },
    { id: "night", name: "Night", bg: ["#22304d", "#0d1321"], ink: "#f4f1e8", accent: "#d9ab52" }
  ];
  const iconImg = new Image(); iconImg.src = "icon.svg";
  function wrapLines(ctx, text, maxWidth) {
    const lines = []; let line = "";
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawVerseCard(canvas, ref, text, style) {
    const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, style.bg[0]); g.addColorStop(1, style.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft glow + large opening quote mark
    const glow = ctx.createRadialGradient(W * 0.25, H * 0.2, 10, W * 0.25, H * 0.2, W * 0.8);
    glow.addColorStop(0, "rgba(255,255,255,0.18)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = style.accent; ctx.globalAlpha = 0.28;
    ctx.font = `700 360px Georgia, "Noto Serif", serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("“", 70, 380); ctx.globalAlpha = 1;
    // verse text: largest size that fits
    const maxW = W - 200, boxH = H - 520;
    let size = 78, lines, lineH;
    do {
      ctx.font = `500 ${size}px Georgia, "Noto Serif", serif`;
      lines = wrapLines(ctx, text, maxW); lineH = size * 1.36;
      if (lines.length * lineH <= boxH) break;
      size -= 3;
    } while (size > 30);
    const blockH = lines.length * lineH;
    let y = 250 + (boxH - blockH) / 2 + size;
    ctx.fillStyle = style.ink; ctx.textAlign = "center";
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += lineH; }
    // reference
    ctx.fillStyle = style.accent; ctx.font = `700 46px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(`${ref.toUpperCase()}  ·  ${trName()}`, W / 2, Math.min(y + 50, H - 190));
    // footer brand
    ctx.globalAlpha = 0.9; ctx.fillStyle = style.ink; ctx.font = `600 36px Georgia, "Noto Serif", serif`;
    const label = "Lamp & Light", lw = ctx.measureText(label).width, iconS = 58, gap = 16;
    const x0 = (W - (iconS + gap + lw)) / 2, fy = H - 90;
    if (iconImg.complete && iconImg.naturalWidth) ctx.drawImage(iconImg, x0, fy - iconS + 12, iconS, iconS);
    ctx.textAlign = "left"; ctx.fillText(label, x0 + iconS + gap, fy);
    ctx.globalAlpha = 1;
  }

  /* ----- share sheet ----- */
  const shareSheet = $("#shareSheet");
  let shareState = null, lastShareFile = null;
  $("#cardStyles").innerHTML = CARD_STYLES.map(s =>
    `<button type="button" class="card-style" data-style="${s.id}" role="radio" aria-label="${s.name}" style="background:linear-gradient(135deg,${s.bg[0]},${s.bg[1]});color:${s.ink}">Aa</button>`).join("");
  function openShare({ eyebrow, text, verse }) {
    shareState = { text, verse };
    $("#shareEyebrow").textContent = eyebrow;
    $("#shareTextPreview").textContent = text;
    $("#shareImageArea").hidden = !verse; $("#shareImageBtn").hidden = !verse;
    $("#shareToGroup").hidden = !window.LLGroups?.canPost() || /Let's read the Bible together|You're invited to join/.test(text);
    $("#shareTextPreview").hidden = !!verse;
    if (verse) renderShareCard();
    if (!shareSheet.open) shareSheet.showModal();
  }
  function renderShareCard() {
    const style = CARD_STYLES.find(s => s.id === state.cardStyle) || CARD_STYLES[0];
    $$("#cardStyles .card-style").forEach(b => b.setAttribute("aria-checked", String(b.dataset.style === style.id)));
    drawVerseCard($("#shareCanvas"), shareState.verse.ref, shareState.verse.text, style);
  }
  if (!iconImg.complete) iconImg.addEventListener("load", () => { if (shareSheet.open && shareState?.verse) renderShareCard(); });
  $("#cardStyles").addEventListener("click", e => {
    const b = e.target.closest("[data-style]"); if (!b) return;
    state.cardStyle = b.dataset.style; save(); renderShareCard();
  });
  $("#shareWhatsApp").addEventListener("click", () => openWhatsApp(shareState.text));
  $("#shareNative").addEventListener("click", () => shareViaApps(shareState.text));
  $("#shareCopy").addEventListener("click", () => copyText(shareState.text));
  // Post the shared item into one of your groups (text without the website link)
  $("#shareToGroup").addEventListener("click", () => {
    const text = shareState.text.replace(/\n*(Read along with us|Shared from Lamp & Light|Pray with us|Study with us|Let's read the Bible together)[\s\S]*$/, "").trim();
    const verse = shareState.verse;
    shareSheet.close();
    window.LLGroups?.pickGroupAndPost(verse ? { text: `“${verse.text}”\n— ${verse.ref}`, kind: "verse", ref: verse.ref } : { text, kind: "text" });
  });
  $("#shareImageBtn").addEventListener("click", async () => {
    const canvas = $("#shareCanvas");
    try {
      if (Share && Filesystem) {
        if (lastShareFile) Filesystem.deleteFile({ path: lastShareFile, directory: "CACHE" }).catch(() => {});
        lastShareFile = `verse-${Date.now()}.jpg`;
        const file = await Filesystem.writeFile({ path: lastShareFile, data: canvas.toDataURL("image/jpeg", 0.92).split(",")[1], directory: "CACHE" });
        await Share.share({ files: [file.uri], dialogTitle: "Share verse picture" });
        return;
      }
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
      const file = new File([blob], "lamp-and-light-verse.jpg", { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); } catch (e) { /* closed */ }
        return;
      }
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
      document.body.appendChild(a); a.click(); a.remove();
      toast("Picture saved. Share it from your downloads");
    } catch (e) {
      toast("Couldn't share the picture");
    }
  });

  function shareVerse(ref, text) { openShare({ eyebrow: `Share ${ref}`, text: verseShareText(ref, text), verse: { ref, text } }); }
  $("#votdShare").addEventListener("click", () => {
    const ref = $("#votdRef").dataset.ref;
    shareVerse(ref, $("#votdText").textContent);
  });
  $("#shareFast").addEventListener("click", () => openShare({ eyebrow: "Share prayer points", text: fastShareText() }));
  $("#shareLesson").addEventListener("click", () => openShare({ eyebrow: "Share this study", text: lessonShareText() }));
  document.addEventListener("click", e => {
    if (e.target.closest("[data-share-reading]")) openShare({ eyebrow: "Share today's reading", text: readingShareText() });
    else if (e.target.closest("[data-share-invite]")) openShare({ eyebrow: "Invite friends to read with you", text: inviteShareText() });
  });

  /* ----- joining a friend's plan ----- */
  let pendingJoin = null;
  function handleJoinCode(code) {
    const p = parsePlanCode(code);
    if (!p) { toast("That invite code isn't valid"); return; }
    const def = p.id === "book" ? buildBookPlan(p.book, p.perDay, p.from) : PLANS.find(x => x.id === p.id);
    if (!def) { toast("That invite code isn't valid"); return; }
    if (state.plan && planCode() === planCode({ ...p })) { toast("You're already reading this plan together"); show("today"); return; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = parseDate(p.start);
    const groupDay = Math.round((today - startDate) / 864e5) + 1;
    const dayNow = Math.min(Math.max(groupDay, 1), def.days.length);
    pendingJoin = { p, def, groupDay, dayNow };
    const startLabel = startDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    $("#joinTitle").textContent = def.title;
    $("#joinInfo").textContent = groupDay < 1
      ? `Your friend's plan starts on ${startLabel}. You'll both read the same passage each day, starting with ${dayLabel(def.days[0])}.`
      : groupDay === 1
        ? `Your friend started today. You'll read the same passage each day, starting with ${dayLabel(def.days[0])}.`
        : `Your friend started on ${startLabel} and is on day ${dayNow} of ${def.days.length}. Today's reading is ${dayLabel(def.days[dayNow - 1])}.`;
    $("#joinInStep").textContent = groupDay > 1 ? `Join them on day ${dayNow}` : "Join and read together";
    $("#joinFromStart").hidden = groupDay <= 1;
    const current = planDef();
    $("#joinReplace").hidden = !current;
    $("#joinReplace").textContent = current ? `This replaces your current plan, “${current.title}”, and its progress.` : "";
    const sheet = $("#joinSheet");
    if (!sheet.open) sheet.showModal();
  }
  function finishJoin(inStep) {
    if (!pendingJoin) return;
    const { p, def, groupDay, dayNow } = pendingJoin;
    const { start, ...rest } = p;
    state.plan = inStep
      ? { ...rest, start, done: {}, current: null, joinDay: groupDay > 1 ? dayNow : 1 }
      : { ...rest, start: dateKey(new Date()), done: {}, current: null, joinDay: 1 };
    save();
    $("#joinSheet").close();
    toast(inStep && groupDay > 1 ? `Joined! You're on day ${dayNow} with your friend.` : `Joined “${def.title}”!`);
    pendingJoin = null;
    show("today");
  }
  $("#joinInStep").addEventListener("click", () => finishJoin(true));
  $("#joinFromStart").addEventListener("click", () => finishJoin(false));
  function checkJoinHash() {
    const g = location.hash.match(/^#group=([A-Za-z0-9]{8})/);
    if (g) {
      history.replaceState(null, "", "#groups");
      openGroupInvite(g[1]);
      return true;
    }
    const m = location.hash.match(/^#join=([\w-]+)/i);
    if (!m) return false;
    history.replaceState(null, "", "#today");
    setTimeout(() => handleJoinCode(m[1]), 250);
    return true;
  }
  // Group invites are handled by groups.js, which loads after this script
  function openGroupInvite(code) {
    if (window.LLGroups) window.LLGroups.openInvite(code);
    else { window.LL.pendingGroupInvite = code.toUpperCase(); setTimeout(() => show("groups"), 0); }
  }

  /* ================= GROUPS BRIDGE (used by groups.js) ================= */
  render.groups = () => {
    if (window.LLGroups) window.LLGroups.render();
    else $("#groupsBody").innerHTML = `<h1>Groups</h1><p class="loading">Loading…</p>`;
  };
  window.LL = {
    NATIVE, SITE, PLANS, escapeHtml, toast, show, copyText, dateKey, parsePlanCode, buildBookPlan, dayLabel,
    openShare: opts => openShare(opts),
    handleJoinCode: code => handleJoinCode(code),
    openExternal: url => { if (NATIVE) location.href = url; else window.open(url, "_blank", "noopener"); },
    votd: () => { const v = VERSES[dayOfYear(new Date()) % VERSES.length]; return { ref: v.ref, text: v.text }; },
    currentPlanCode: () => (planDef() ? planCode() : null),
    currentPlanTitle: () => planDef()?.title || "",
    openTodayReading: () => openNextReading(),
    todayReading: () => {
      const plan = planDef(); if (!plan) return null;
      const s = planStats(plan); if (s.finished) return null;
      const day = Math.min(s.focus, plan.days.length);
      return { title: plan.title, day, label: dayLabel(plan.days[day - 1]), question: DISCUSSION_QUESTIONS[(day - 1) % DISCUSSION_QUESTIONS.length] };
    },
    pendingGroupInvite: null,
    // let Groups hand a photo to the phone's share sheet (or the browser's download)
    sharePhoto: async (dataUrl, title) => {
      try {
        if (Share && Filesystem) {
          if (lastShareFile) Filesystem.deleteFile({ path: lastShareFile, directory: "CACHE" }).catch(() => {});
          lastShareFile = `photo-${Date.now()}.jpg`;
          const file = await Filesystem.writeFile({ path: lastShareFile, data: dataUrl.split(",")[1], directory: "CACHE" });
          await Share.share({ files: [file.uri], dialogTitle: title || "Share photo" });
          return;
        }
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], "lamp-and-light-photo.jpg", { type: "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) { /* closed */ } return; }
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
        document.body.appendChild(a); a.click(); a.remove();
        toast("Photo saved to your downloads");
      } catch (e) { toast("Couldn't share that photo"); }
    }
  };

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
      <li class="alarm${a.enabled ? "" : " off"}" data-edit="${a.id}" tabindex="0" role="button" aria-label="Edit ${escapeHtml(a.label)}">
        <div>
          <div class="time">${fmtTime(a.time)}</div>
        </div>
        <div class="actions">
          ${a.system ? "" : `<button class="icon-btn" data-del="${a.id}" aria-label="Delete ${escapeHtml(a.label)}" style="font-size:1rem">🗑</button>`}
          <label class="toggle" title="On/off"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""} aria-label="Enable ${escapeHtml(a.label)}"><span></span></label>
        </div>
        <div class="meta"><strong style="color:var(--ink)">${escapeHtml(a.label)}</strong>
          <span class="tag">${a.system ? "Fasting plan" : a.id === "a-reading" ? "Reading plan" : kindLabel[a.kind]}</span><br>${daysText(a.days)} · 🔔 ${escapeHtml(toneName(toneFor(a)))}${
            a.id === "a-reading" && planDef() ? ` · says which ${state.plan.id === "book" ? "chapter" : "passage"} to read` : ""}</div>
      </li>`).join("")
      : `<li class="card muted">No reminders yet — add one below.</li>`;
  };
  $("#alarmList").addEventListener("change", e => {
    const t = e.target.closest("[data-toggle]"); if (!t) return;
    const a = state.alarms.find(x => x.id === t.dataset.toggle);
    a.enabled = t.checked; save(); render.alarms();
  });
  $("#alarmList").addEventListener("click", e => {
    const row = e.target.closest("[data-edit]");
    if (row && !e.target.closest("[data-del], .toggle")) {
      const a = state.alarms.find(x => x.id === row.dataset.edit);
      if (a) { openAlarmEditor(a); return; }
    }
    const d = e.target.closest("[data-del]"); if (!d) return;
    const a = state.alarms.find(x => x.id === d.dataset.del);
    if (confirm(`Delete “${a.label}”?`)) { state.alarms = state.alarms.filter(x => x !== a); save(); render.alarms(); }
  });
  /* ----- choosing sounds ----- */
  $("#alarmDays").insertAdjacentHTML("afterend", "");   // (kept for layout order)
  function fillToneSelects() {
    $("#setTone").innerHTML = toneOptions(state.tone || "chime", false);
    $("#alarmSound").innerHTML = toneOptions("", true);
  }
  fillToneSelects();
  $("#setTone").addEventListener("change", e => {
    state.tone = e.target.value; save(); fillToneSelects();
    playTone(state.tone) || toast(toneName(state.tone) === "Silent (vibration only)" ? "Reminders will only vibrate" : "Your phone's own notification sound will be used");
    if (!$("#view-alarms").hidden) render.alarms();
  });
  $("#setTonePreview").addEventListener("click", () => { unlockAudio(); if (!playTone($("#setTone").value)) toast("That's your phone's own sound — it can't be played here"); });
  $("#alarmSoundPreview").addEventListener("click", () => { unlockAudio(); playTone($("#alarmSound").value || state.tone || "chime"); });
  $("#editSoundPreview").addEventListener("click", () => { unlockAudio(); playTone($("#editSound").value || state.tone || "chime"); });
  $$("dialog").forEach(d => d.addEventListener("close", stopTone));

  /* ----- editing a reminder ----- */
  const alarmEdit = $("#alarmEditSheet");
  $("#editDays").insertAdjacentHTML("beforeend", DAY_SHORT.map((d, i) =>
    `<label class="day-btn" title="${DAY_NAMES[i]}"><input type="checkbox" value="${i}"><span>${d}</span></label>`).join(""));
  let editingId = null;
  function openAlarmEditor(a) {
    editingId = a.id;
    $("#editLabel").value = a.label;
    $("#editLabel").disabled = !!a.system;          // fasting-plan reminders are named by the plan
    $("#editTime").value = a.time;
    $("#editTime").disabled = !!a.system;
    $("#editKind").value = a.kind;
    $("#editKind").disabled = !!a.system;
    $("#editSound").innerHTML = toneOptions(a.sound || "", true);
    $("#editSound").value = a.sound || "";
    $$("#editDays input").forEach(i => { i.checked = a.days.includes(+i.value); i.disabled = !!a.system; });
    $("#editDelete").hidden = !!a.system;
    alarmEdit.showModal();
  }
  $("#alarmEditForm").addEventListener("submit", e => {
    e.preventDefault();
    const a = state.alarms.find(x => x.id === editingId);
    if (!a) { alarmEdit.close(); return; }
    const sound = $("#editSound").value;
    if (sound) a.sound = sound; else delete a.sound;
    if (!a.system) {
      const days = $$("#editDays input:checked").map(i => +i.value);
      if (!days.length) { toast("Pick at least one day"); return; }
      Object.assign(a, { label: $("#editLabel").value.trim() || "Reminder", time: $("#editTime").value, days, kind: $("#editKind").value });
    }
    save(); alarmEdit.close(); render.alarms(); toast("Reminder updated");
  });
  $("#editCancel").addEventListener("click", () => alarmEdit.close());
  $("#editDelete").addEventListener("click", () => {
    const a = state.alarms.find(x => x.id === editingId);
    if (!a || !confirm(`Delete “${a.label}”?`)) return;
    state.alarms = state.alarms.filter(x => x !== a);
    save(); alarmEdit.close(); render.alarms(); toast("Reminder deleted");
  });

  $("#alarmForm").addEventListener("submit", e => {
    e.preventDefault();
    const days = $$("#alarmDays input:checked").map(i => +i.value);
    if (!days.length) { toast("Pick at least one day"); return; }
    state.alarms.push({
      id: "a-" + Date.now().toString(36), label: $("#alarmLabel").value.trim() || "Reminder",
      time: $("#alarmTime").value, days, kind: $("#alarmKind").value, enabled: true,
      ...($("#alarmSound").value ? { sound: $("#alarmSound").value } : {})
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
      channelId: channelFor(state.tone || "chime"), smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
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
          // Reading reminder with an active plan: one notification per day for the next 60 days, each naming that day's reading
          const readings = a.id === "a-reading" ? upcomingReadingReminders(a, 60) : null;
          if (readings && readings.length) {
            readings.forEach((r, k) => list.push({
              id: 3000000 + k, title: `📖 Today's reading: ${r.label}`,
              body: `${r.title} · Day ${r.day} of ${r.total}. Tap to start reading.${r.last ? " Open Lamp & Light to keep your reminders coming." : ""}`,
              channelId: channelFor(toneFor(a)), smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
              schedule: { at: r.at, allowWhileIdle: true }, extra: { kind: "reading", id: a.id }
            }));
            continue;
          }
          const [hour, minute] = a.time.split(":").map(Number);
          const v = alarmVerse(a.kind);
          for (const d of a.days) {
            list.push({
              id: hashId(a.id) * 10 + d, title: a.label, body: `${v.ref} — ${v.text}`, largeBody: `“${v.text}” — ${v.ref}`,
              channelId: channelFor(toneFor(a)), smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
              schedule: { on: { weekday: d + 1, hour, minute }, allowWhileIdle: true },
              extra: { kind: a.kind, id: a.id }
            });
          }
        }
        state.snoozes.filter(s => s.at > Date.now()).forEach((s, i) => list.push({
          id: 2000000 + i, title: s.label, body: "Snoozed reminder", channelId: channelFor(s.sound || state.tone || "chime"), smallIcon: "ic_stat_notify", iconColor: "#7A3B2E", isExactNotification: exactAlarms === "granted",
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

  const ALARM_VERSES = { prayer: ["Matthew 6:6", "1 Thessalonians 5:16-18", "Philippians 4:6-7"], study: ["Psalms 119:105", "2 Timothy 3:16-17", "Joshua 1:9"], fast: ["Isaiah 58:6", "Joel 2:12", "Matthew 6:33"], reading: ["Psalms 119:105", "2 Timothy 3:16-17", "Matthew 11:28"] };
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

    unlockAudio();
    const tone = toneFor(a);
    if (!playTone(tone, { loop: true })) {          // "phone's default" in the browser: use the built-in chime
      chime();
      clearInterval(chimeTimer); chimeTimer = setInterval(chime, 2600);
    }
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
    stopTone();
    clearInterval(chimeTimer); clearTimeout(ringStopTimer);
    const dlg = $("#alarmRing"); if (dlg.open) dlg.close();
    ringing = null;
  }
  $("#ringStop").addEventListener("click", () => {
    const kind = ringing?.kind;
    stopRing();
    if (kind === "fast") show("fast"); else if (kind === "study") show("study"); else if (kind === "reading") openNextReading();
  });
  $("#ringSnooze").addEventListener("click", () => {
    if (ringing && ringing.id !== "test") {
      state.snoozes.push({ id: ringing.id, label: ringing.label, kind: ringing.kind, sound: ringing.sound, at: Date.now() + 5 * 60000 });
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
        const info = readingAlarmNow(a);   // reading reminder names today's chapter; skipped if already read
        if (info) ring(info);
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
    if (audioSupported) {
      $("#voiceSetting").hidden = false; $("#continueSetting").hidden = false;
      $("#setAudioContinue").checked = state.audio.continue !== false;
      loadVoices().then(list => {
        const english = list.filter(v => /^en/i.test(v.lang || ""));
        $("#setVoice").innerHTML = `<option value="">Phone default</option>` + english
          .map(v => `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name || v.voiceURI)} (${escapeHtml(v.lang)})${v.localService === false ? " · needs internet" : ""}</option>`).join("");
        $("#setVoice").value = english.some(v => v.voiceURI === state.audio.voice) ? state.audio.voice : "";
      });
    }
    settings.returnValue = "";
    settings.showModal();
  });
  $("#setVoice").addEventListener("change", e => { state.audio.voice = e.target.value; save(); if (player.playing) playFrom(player.idx); });
  $("#setAudioContinue").addEventListener("change", e => { state.audio.continue = e.target.checked; save(); });
  $("#testVoice").addEventListener("click", async () => {
    const token = ++player.token;   // interrupts any chapter being read
    player.playing = false; updatePlayer();
    await engineStop();
    const text = "Thy word is a lamp unto my feet, and a light unto my path.";
    const voice = voiceList.find(v => v.voiceURI === state.audio.voice);
    if (TTS) TTS.speak({ text, lang: voice?.lang || ttsLang, rate: state.audio.rate || 1, voice: voice ? voice.index : undefined }).catch(() => toast("This voice isn't available"));
    else if (webSpeech && token === player.token) {
      const u = new SpeechSynthesisUtterance(text); u.rate = state.audio.rate || 1;
      const wv = webSpeech.getVoices().find(v => v.voiceURI === state.audio.voice); if (wv) { u.voice = wv; u.lang = wv.lang; }
      webSpeech.speak(u);
    }
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
  if (!checkJoinHash()) show(location.hash.slice(1) || "today");
  else show("today");
  checkAlarms();
  setInterval(() => { if (!$("#view-today").hidden) render.today(); }, 60000);

  if (NATIVE) {
    (async () => {
      try {
        for (const tone of TONES) {
          await LN.createChannel({
            id: channelFor(tone.id),
            name: `Reminders · ${tone.name}`,
            description: "Your Lamp & Light prayer, reading, study and fasting reminders",
            importance: 4, visibility: 1, vibration: true, lights: true, lightColor: "#A87A26",
            ...(tone.file ? { sound: tone.file.replace("sounds/", "") } : {}),
            ...(tone.silence ? { sound: "silence" } : {})
          });
        }
      } catch (e) { /* channels need Android 8+ */ }
      await refreshPermission();
      if (permission === "prompt") await requestNotif(); else syncNativeAlarms();
      if (!$("#view-today").hidden) render.today();
    })();

    // Tapping a notification opens the matching screen
    LN.addListener("localNotificationActionPerformed", e => {
      const kind = e.notification?.extra?.kind;
      stopRing();
      if (kind === "reading") openNextReading();
      else show(kind === "fast" ? "fast" : kind === "study" ? "study" : "today");
    });
    // An alarm going off while the app is open shows the alarm screen
    LN.addListener("localNotificationReceived", n => {
      ring({ id: n.extra?.id || "notification", label: n.title, kind: n.extra?.kind || "prayer" }, true);
    });
    // Android back button: close dialogs, then go to Today, then leave the app
    // Invite links: lampandlight://join?c=CODE (from the website's "Open in the app" button)
    const joinFromUrl = url => {
      const g = String(url || "").match(/[?&]g=([A-Za-z0-9]{8})/);
      if (g) { openGroupInvite(g[1]); return; }
      const m = String(url || "").match(/[?&]c=([\w-]+)/i);
      if (m) handleJoinCode(m[1]);
    };
    AppPlugin.addListener("appUrlOpen", e => joinFromUrl(e.url));
    AppPlugin.getLaunchUrl().then(r => r?.url && joinFromUrl(r.url)).catch(() => {});

    AppPlugin.addListener("backButton", () => {
      const open = $$("dialog[open]");
      if (open.length) { open.forEach(d => (d.id === "alarmRing" ? stopRing() : d.close("close"))); return; }
      if (window.LLGroups?.handleBack()) return;   // inside a group: back to the group list
      if ((location.hash.slice(1) || "today") !== "today") show("today");
      else AppPlugin.exitApp();
    });
    AppPlugin.addListener("resume", async () => {
      const before = permission + exactAlarms;
      await refreshPermission();
      if (permission + exactAlarms !== before) syncNativeAlarms();   // e.g. user changed access in Settings
      else checkNativeSync();                                         // new day: refresh the chapter-by-chapter reminders
      const v = location.hash.slice(1) || "today";
      if (v === "today" || v === "alarms" || v === "fast") render[v]();  // don't reset the Bible/Study scroll position
    });
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
