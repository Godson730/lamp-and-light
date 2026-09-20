/* Lamp & Light: invite-only Bible groups (chat, prayer wall, group reading) on Firebase.
   Security is enforced by firestore.rules; this file only builds the screens. */
import { initializeApp } from "./vendor/firebase/firebase-app.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential, deleteUser
} from "./vendor/firebase/firebase-auth.js";
import {
  initializeFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  collectionGroup, query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, arrayUnion, arrayRemove, getDocs
} from "./vendor/firebase/firebase-firestore.js";
import { firebaseConfig, emulatorConfig } from "./firebase-config.js";

const LL = window.LL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = LL.escapeHtml;
const GUIDELINES_VERSION = 1;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* ---------- setup ---------- */
let useEmulator = false;
try { useEmulator = !LL.NATIVE && location.port === "8766" && localStorage.getItem("ll-use-emulator") === "1"; } catch (e) { /* storage blocked */ }
const config = useEmulator ? emulatorConfig : firebaseConfig;
let auth = null, db = null;
if (config) {
  const app = initializeApp(config);
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = initializeFirestore(app, {});
  if (useEmulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
  }
}

const S = {
  authReady: false, user: null, profile: null, profileLoaded: false,
  groups: [], groupsLoaded: false,               // [{ id, name, role, group }]
  blocked: new Map(),                            // uid -> name
  current: null, tab: "chat",                   // open group id and section
  group: null, members: [], messages: [], prayers: [], reports: [], bans: [],
  pendingInvite: null,                           // invite code waiting for sign-in / confirmation
  authMode: "signin", busy: false
};
let unsubs = [], homeUnsubs = [];
const clearSubs = list => { list.forEach(u => u()); list.length = 0; };

/* ---------- helpers ---------- */
const view = () => $("#groupsBody");
const visible = () => !$("#view-groups").hidden;
function rerender() { if (visible()) render(); }
function friendlyError(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-credential": "That email or password isn't right.",
    "auth/wrong-password": "That password isn't right.",
    "auth/user-not-found": "There's no account with that email.",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in.",
    "auth/weak-password": "Please choose a password with at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection. Groups need internet.",
    "auth/requires-recent-login": "Please enter your password again to continue.",
    "permission-denied": "You don't have permission to do that.",
    "unavailable": "No internet connection. Groups need internet.",
    "groups-not-ready": "Groups aren't switched on yet. Please try again later."
  };
  return map[code] || "Something went wrong. Please try again.";
}
function when(ts) {
  if (!ts?.toDate) return "sending…";
  const d = ts.toDate(), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), n => CODE_CHARS[n % CODE_CHARS.length]).join("");
const inviteUrl = code => `${LL.SITE}join.html?g=${code}`;
const myName = () => S.profile?.name || S.user?.displayName || "Friend";
const todayKey = () => LL.dateKey(new Date());
const isLeader = () => ["owner", "admin"].includes(S.members.find(m => m.id === S.user?.uid)?.role);
const isOwner = () => S.members.find(m => m.id === S.user?.uid)?.role === "owner";
function busy(on) { S.busy = on; $$("#groupsBody button, #groupsBody input, #groupsBody textarea").forEach(el => { if (!el.dataset.keepEnabled) el.disabled = on; }); }
async function run(fn, okMessage) {
  busy(true);
  try { await fn(); if (okMessage) LL.toast(okMessage); return true; }
  catch (e) { console.warn(e); LL.toast(friendlyError(e)); return false; }
  finally { busy(false); }
}

/* ---------- auth & profile ---------- */
if (auth) {
  onAuthStateChanged(auth, async user => {
    S.user = user; S.authReady = true; S.profile = null; S.profileLoaded = false;
    clearSubs(homeUnsubs); closeGroup(false);
    if (user) {
      try { const snap = await getDoc(doc(db, "users", user.uid)); S.profile = snap.exists() ? snap.data() : null; } catch (e) { S.profile = null; }
      S.profileLoaded = true;
      if (S.profile) watchHome();
    }
    rerender();
    if (user && S.profile && S.pendingInvite) openInvite(S.pendingInvite);
  });
}

function watchHome() {
  clearSubs(homeUnsubs);
  S.groupsLoaded = false;
  homeUnsubs.push(onSnapshot(query(collectionGroup(db, "members"), where("uid", "==", S.user.uid)), async snap => {
    const list = await Promise.all(snap.docs.map(async m => {
      const gid = m.ref.parent.parent.id;
      try { const g = await getDoc(doc(db, "groups", gid)); return g.exists() ? { id: gid, role: m.data().role, group: g.data() } : null; }
      catch (e) { return null; }
    }));
    S.groups = list.filter(Boolean).sort((a, b) => a.group.name.localeCompare(b.group.name));
    S.groupsLoaded = true;
    if (!S.current) rerender();
  }, e => { console.warn(e); S.groupsLoaded = true; rerender(); }));
  homeUnsubs.push(onSnapshot(collection(db, "users", S.user.uid, "blocked"), snap => {
    S.blocked = new Map(snap.docs.map(d => [d.id, d.data().name || "Someone"]));
    rerender();
  }));
}

/* ---------- rendering ---------- */
function render() {
  const el = view();
  if (!config) {
    el.innerHTML = `
      <h1>Groups</h1>
      <article class="card">
        <h2>Coming soon 🙏</h2>
        <p>Private groups for your church, family and friends: chat about the Scriptures, share prayer requests and read the same plan together.</p>
        <p class="muted small">Until then, share readings and invite friends to read with you from the Today screen.</p>
      </article>`;
    return;
  }
  if (!S.authReady) { el.innerHTML = `<h1>Groups</h1><p class="loading">Loading…</p>`; return; }
  if (!S.user) return renderAuth(el);
  if (!S.profileLoaded) { el.innerHTML = `<h1>Groups</h1><p class="loading">Loading your profile…</p>`; return; }
  if (!S.profile) return renderProfileSetup(el);
  if (S.current) return renderGroup(el);
  return renderHome(el);
}

function renderAuth(el) {
  const signup = S.authMode === "signup";
  el.innerHTML = `
    <h1>Groups</h1>
    <p class="lead">Private, invite-only groups to chat about God's Word, pray for one another and read together.</p>
    ${S.pendingInvite ? `<p class="notice small">Sign in or create an account to join the group you were invited to.</p>` : ""}
    <article class="card auth-card">
      <div class="seg" role="tablist">
        <button type="button" role="tab" aria-selected="${!signup}" data-auth-mode="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="${signup}" data-auth-mode="signup">Create account</button>
      </div>
      <form id="authForm" class="stack" autocomplete="on">
        ${signup ? `<label>Your name <input id="authName" maxlength="40" required autocomplete="name" placeholder="How others will see you"></label>` : ""}
        <label>Email <input id="authEmail" type="email" required autocomplete="email"></label>
        <label>Password <input id="authPassword" type="password" required minlength="6" autocomplete="${signup ? "new-password" : "current-password"}"></label>
        ${signup ? `
          <label class="switch-row"><input type="checkbox" id="authAgree" required>
            <span>I am 13 or older and agree to the <button type="button" class="link" data-guidelines>Community Guidelines</button>.</span></label>` : ""}
        <button class="btn" type="submit">${signup ? "Create account" : "Sign in"}</button>
        ${signup ? "" : `<button type="button" class="link small" id="authForgot">Forgot password?</button>`}
      </form>
    </article>
    <p class="muted small">Your account is only used for groups. Reading, study, fasting and reminders keep working without it.
      <button type="button" class="link" data-privacy>How we handle your data</button></p>`;
  $$("[data-auth-mode]", el).forEach(b => b.addEventListener("click", () => { S.authMode = b.dataset.authMode; render(); }));
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#authEmail").value.trim(), password = $("#authPassword").value;
    if (signup) {
      const name = $("#authName").value.trim();
      if (!$("#authAgree").checked) { LL.toast("Please confirm you're 13+ and agree to the guidelines"); return; }
      await run(async () => {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        const profile = { name, over13: true, guidelinesVersion: GUIDELINES_VERSION, acceptedAt: serverTimestamp() };
        await setDoc(doc(db, "users", cred.user.uid), profile).catch(e => {
          if (e?.code === "permission-denied") throw Object.assign(new Error("not-ready"), { code: "groups-not-ready" });
          throw e;
        });
        S.profile = { ...profile }; S.profileLoaded = true; watchHome(); render();
        if (S.pendingInvite) openInvite(S.pendingInvite);
      }, `Welcome, ${name}!`);
    } else {
      await run(() => signInWithEmailAndPassword(auth, email, password));
    }
  });
  const forgot = $("#authForgot");
  if (forgot) forgot.addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) { LL.toast("Type your email above first"); return; }
    await run(() => sendPasswordResetEmail(auth, email), "Check your email for a link to reset your password");
  });
}

function renderProfileSetup(el) {
  el.innerHTML = `
    <h1>Welcome</h1>
    <article class="card">
      <form id="profileForm" class="stack">
        <label>Your name <input id="profName" maxlength="40" required value="${esc(S.user.displayName || "")}"></label>
        <label class="switch-row"><input type="checkbox" id="profAgree" required>
          <span>I am 13 or older and agree to the <button type="button" class="link" data-guidelines>Community Guidelines</button>.</span></label>
        <button class="btn" type="submit">Continue</button>
      </form>
    </article>
    <button type="button" class="link small" id="profSignOut">Sign out</button>`;
  $("#profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#profName").value.trim();
    await run(async () => {
      const profile = { name, over13: true, guidelinesVersion: GUIDELINES_VERSION, acceptedAt: serverTimestamp() };
      await setDoc(doc(db, "users", S.user.uid), profile).catch(e => {
        if (e?.code === "permission-denied") throw Object.assign(new Error("not-ready"), { code: "groups-not-ready" });
        throw e;
      });
      S.profile = profile; watchHome(); render();
    });
  });
  $("#profSignOut").addEventListener("click", () => signOut(auth));
}

function renderHome(el) {
  el.innerHTML = `
    <div class="row between wrap">
      <h1>Groups</h1>
      <button type="button" class="btn ghost small" id="profileBtn">👤 ${esc(myName())}</button>
    </div>
    <div class="row gap wrap" style="margin-bottom:14px">
      <button type="button" class="btn" id="createGroupBtn">＋ Create a group</button>
      <form class="search join-group" id="joinGroupForm" autocomplete="off">
        <input id="joinGroupCode" placeholder="Invite code" maxlength="8" aria-label="Group invite code" autocapitalize="characters">
        <button class="btn ghost" type="submit">Join</button>
      </form>
    </div>
    ${!S.groupsLoaded ? `<p class="loading">Loading your groups…</p>`
      : S.groups.length ? `<ul class="group-list">${S.groups.map(g => `
          <li><button type="button" class="group-item" data-open-group="${g.id}">
            <span class="group-avatar" aria-hidden="true">${esc(g.group.name.trim()[0]?.toUpperCase() || "✝")}</span>
            <span class="grow"><strong>${esc(g.group.name)}</strong><span class="muted small">${g.role === "owner" ? "Leader" : g.role === "admin" ? "Co-leader" : "Member"}${g.group.description ? ` · ${esc(g.group.description)}` : ""}</span></span>
            <span aria-hidden="true">›</span>
          </button></li>`).join("")}</ul>`
      : `<article class="card empty"><h2>No groups yet</h2>
          <p>Create a group for your church, cell, family or friends and share the invite link on WhatsApp.
          Or ask your leader for their invite link or code.</p></article>`}
    <p class="muted small center" style="margin-top:18px">
      <button type="button" class="link" data-guidelines>Community Guidelines</button> ·
      <button type="button" class="link" data-privacy>Privacy</button>
    </p>`;
  $("#createGroupBtn").addEventListener("click", openCreateGroup);
  $("#profileBtn").addEventListener("click", openProfile);
  $("#joinGroupForm").addEventListener("submit", e => {
    e.preventDefault();
    const code = $("#joinGroupCode").value.trim().toUpperCase();
    if (code) openInvite(code);
  });
  $$("[data-open-group]", el).forEach(b => b.addEventListener("click", () => openGroup(b.dataset.openGroup)));
}

/* ---------- create / join ---------- */
function openCreateGroup() {
  openDialog(`
    <h2>Create a group</h2>
    <form id="cgForm" class="stack">
      <label>Group name <input id="cgName" maxlength="40" required placeholder="e.g. Grace Chapel Youth"></label>
      <label>Short description (optional) <input id="cgDesc" maxlength="300" placeholder="e.g. Tuesday cell group"></label>
      <p class="muted small">Only people you invite can join. You'll be the group leader and can remove messages or members.</p>
      <div class="share-actions"><button class="btn" type="submit">Create group</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`, dlg => {
    $("#cgForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("#cgName", dlg).value.trim(), description = $("#cgDesc", dlg).value.trim();
      let gid;
      const ok = await run(async () => {
        let code = newCode();
        for (let i = 0; i < 5 && (await getDoc(doc(db, "invites", code))).exists(); i++) code = newCode();
        const ref = doc(collection(db, "groups")); gid = ref.id;
        const b = writeBatch(db);
        b.set(ref, { name, ...(description ? { description } : {}), ownerId: S.user.uid, inviteCode: code, createdAt: serverTimestamp() });
        b.set(doc(db, "groups", gid, "members", S.user.uid), { uid: S.user.uid, name: myName(), role: "owner", joinedAt: serverTimestamp() });
        b.set(doc(db, "invites", code), { groupId: gid, name });
        await b.commit();
      }, `“${name}” created! Invite your people.`);
      if (ok) { dlg.close(); openGroup(gid, "members"); }
    });
  });
}

async function openInvite(code) {
  code = String(code || "").toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) { LL.toast("That group code isn't valid"); return; }
  S.pendingInvite = code;
  if (!config) { LL.show("groups"); return; }
  if (!S.user || !S.profile) { LL.show("groups"); return; }
  LL.show("groups");
  try {
    const inv = await getDoc(doc(db, "invites", code));
    if (!inv.exists()) { S.pendingInvite = null; LL.toast("This invite link has expired. Ask the leader for a new one."); return; }
    const { groupId, name } = inv.data();
    if (S.groups.some(g => g.id === groupId)) { S.pendingInvite = null; openGroup(groupId); return; }
    openDialog(`
      <p class="eyebrow">You're invited</p>
      <h2>Join “${esc(name)}”?</h2>
      <p>In groups you can chat about the Bible, share prayer requests and read together.</p>
      <p class="muted small">Members will see your name (<strong>${esc(myName())}</strong>) and what you post.
        By joining you agree to the <button type="button" class="link" data-guidelines>Community Guidelines</button>.</p>
      <div class="share-actions"><button type="button" class="btn" id="joinGo">Join group</button><button type="button" class="btn ghost" data-close>Not now</button></div>`, dlg => {
      $("#joinGo", dlg).addEventListener("click", async () => {
        const ok = await run(() => setDoc(doc(db, "groups", groupId, "members", S.user.uid),
          { uid: S.user.uid, name: myName(), role: "member", joinedAt: serverTimestamp(), inviteCode: code }), `Welcome to ${name}!`);
        if (ok) { S.pendingInvite = null; dlg.close(); openGroup(groupId, "chat"); }
        else LL.toast("Couldn't join. The link may be out of date, or you were removed from this group.");
      });
    }, () => { S.pendingInvite = null; });
  } catch (e) { LL.toast(friendlyError(e)); }
}

/* ---------- a group ---------- */
function openGroup(gid, tab = "chat") {
  closeGroup(false);
  S.current = gid; S.tab = tab;
  S.group = null; S.members = []; S.messages = []; S.prayers = []; S.reports = []; S.bans = [];
  const onErr = e => { console.warn(e); if (e.code === "permission-denied") { LL.toast("You're no longer a member of this group"); closeGroup(); } };
  unsubs.push(onSnapshot(doc(db, "groups", gid), s => {
    S.group = s.exists() ? { id: s.id, ...s.data() } : null;
    if (!s.exists()) { LL.toast("This group was deleted"); closeGroup(); return; }
    const entry = S.groups.find(x => x.id === gid); if (entry) entry.group = s.data();   // keep "My groups" in sync
    paint();
  }, onErr));
  unsubs.push(onSnapshot(collection(db, "groups", gid, "members"), s => {
    S.members = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.user && !S.members.some(m => m.id === S.user.uid)) { LL.toast("You're no longer a member of this group"); closeGroup(); return; }
    watchLeaderData(); paint();
  }, onErr));
  unsubs.push(onSnapshot(query(collection(db, "groups", gid, "messages"), orderBy("createdAt", "desc"), limit(150)), s => {
    S.messages = s.docs.map(d => ({ id: d.id, ...d.data() })).reverse(); paint("messages");
  }, onErr));
  unsubs.push(onSnapshot(query(collection(db, "groups", gid, "prayers"), orderBy("createdAt", "desc"), limit(100)), s => {
    S.prayers = s.docs.map(d => ({ id: d.id, ...d.data() })); paint("prayers");
  }, onErr));
  LL.show("groups");
  render();
}
let leaderUnsubs = [];
function watchLeaderData() {
  if (!isLeader() || leaderUnsubs.length) return;
  const gid = S.current;
  leaderUnsubs.push(onSnapshot(collection(db, "groups", gid, "reports"), s => { S.reports = s.docs.map(d => ({ id: d.id, ...d.data() })); paint("reports"); }, () => {}));
  leaderUnsubs.push(onSnapshot(collection(db, "groups", gid, "bans"), s => { S.bans = s.docs.map(d => ({ id: d.id, ...d.data() })); paint("members"); }, () => {}));
}
function closeGroup(show = true) {
  clearSubs(unsubs); clearSubs(leaderUnsubs);
  S.current = null; S.group = null;
  if (show) rerender();
}

let paintTimer = null;
function paint() {
  if (!visible() || !S.current) return;
  clearTimeout(paintTimer);
  paintTimer = setTimeout(() => {
    // keep a half-typed message and scroll position while live updates arrive
    const draft = $("#chatInput")?.value, prayerDraft = $("#prayerInput")?.value;
    const list = $("#chatList"); const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    render();
    if (draft != null && $("#chatInput")) $("#chatInput").value = draft;
    if (prayerDraft != null && $("#prayerInput")) $("#prayerInput").value = prayerDraft;
    const l2 = $("#chatList"); if (l2 && nearBottom) l2.scrollTop = l2.scrollHeight;
  }, 40);
}

function renderGroup(el) {
  const g = S.group;
  if (!g) { el.innerHTML = `<button type="button" class="link small back-link" data-back>‹ Groups</button><p class="loading">Opening group…</p>`; $("[data-back]", el).addEventListener("click", () => closeGroup()); return; }
  const reportsBadge = isLeader() && S.reports.length ? ` <span class="badge">${S.reports.length}</span>` : "";
  const tabs = [["chat", "Chat"], ["prayer", "Prayer"], ["reading", "Reading"], ["members", `Members${reportsBadge}`]];
  el.innerHTML = `
    <button type="button" class="link small back-link" data-back>‹ Groups</button>
    <div class="group-head">
      <div class="grow"><h1>${esc(g.name)}</h1><p class="muted small">${S.members.length} ${S.members.length === 1 ? "member" : "members"}${g.description ? ` · ${esc(g.description)}` : ""}</p></div>
      <button type="button" class="btn small" id="inviteBtn">Invite</button>
    </div>
    <div class="seg group-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${S.tab === id}" data-gtab="${id}">${label}</button>`).join("")}</div>
    <div id="groupPane"></div>`;
  $("[data-back]", el).addEventListener("click", () => closeGroup());
  $("#inviteBtn").addEventListener("click", shareInvite);
  $$("[data-gtab]", el).forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.gtab; render(); }));
  const pane = $("#groupPane");
  ({ chat: renderChat, prayer: renderPrayer, reading: renderReading, members: renderMembers })[S.tab](pane);
}

function shareInvite() {
  const g = S.group;
  LL.openShare({ eyebrow: `Invite people to ${g.name}`, text:
    `🙏 You're invited to join *${g.name}* on Lamp & Light, a private group where we chat about the Bible, pray for one another and read together.\n\nTap to join 👇\n${inviteUrl(g.inviteCode)}\n\nGroup code: *${g.inviteCode}*` });
}

/* ----- chat ----- */
function renderChat(pane) {
  const me = S.user.uid;
  const visibleMsgs = S.messages.filter(m => !S.blocked.has(m.uid));
  const hidden = S.messages.length - visibleMsgs.length;
  const reading = LL.todayReading();
  pane.innerHTML = `
    <div class="chat" id="chatList" aria-live="polite">
      ${visibleMsgs.length ? visibleMsgs.map(m => `
        <div class="msg ${m.uid === me ? "mine" : ""} kind-${esc(m.kind)}" data-msg="${m.id}" tabindex="0">
          ${m.uid === me ? "" : `<span class="msg-name">${esc(m.name)}</span>`}
          ${m.kind === "photo" || m.kind === "video" ? photoMarkup(m) : ""}
          ${m.text ? `<span class="msg-text">${esc(m.text)}</span>` : ""}
          <span class="msg-time">${when(m.createdAt)}</span>
        </div>`).join("") : `<p class="muted center chat-empty">No messages yet. Say hello and share what God is teaching you! 👋</p>`}
      ${hidden ? `<p class="muted small center">${hidden} message${hidden > 1 ? "s" : ""} hidden from people you blocked</p>` : ""}
    </div>
    <div class="quick-posts">
      ${reading ? `<button type="button" class="chip" id="postReading">📖 Share today's reading</button>` : ""}
      <button type="button" class="chip" id="postVerse">✝ Share verse of the day</button>
    </div>
    <form class="composer" id="chatForm">
      <input type="file" id="photoPicker" accept="image/*,video/*" hidden>
      <button type="button" class="pl-btn attach" id="attachPhoto" aria-label="Send a photo or video" title="Send a photo or video">📷</button>
      <textarea id="chatInput" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Message ${esc(S.group.name)}"></textarea>
      <button class="btn" type="submit" aria-label="Send">Send</button>
    </form>`;
  const list = $("#chatList"); list.scrollTop = list.scrollHeight;
  const input = $("#chatInput");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !LL.NATIVE && !/Android|iPhone/i.test(navigator.userAgent)) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  $("#chatForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; input.style.height = "auto";
    const ok = await postMessage({ text, kind: "text" });
    if (!ok) input.value = text;
    $("#chatInput")?.focus();
  });
  const pr = $("#postReading");
  if (pr) pr.addEventListener("click", () => postMessage({ text: `📖 ${reading.title} · Day ${reading.day}\nToday's reading: ${reading.label}\n\n💬 ${reading.question}`, kind: "reading", ref: reading.label.slice(0, 60) }));
  $("#postVerse").addEventListener("click", () => { const v = LL.votd(); postMessage({ text: `“${v.text}”\n— ${v.ref}`, kind: "verse", ref: v.ref }); });
  $$("[data-msg]", pane).forEach(b => b.addEventListener("click", e => {
    const m = S.messages.find(x => x.id === b.dataset.msg);
    if (e.target.closest(".msg-photo") && m?.kind === "video") viewVideo(m);   // tap to play
    else if (e.target.closest(".msg-photo") && m?.kind === "photo") viewPhoto(m);   // tap the picture to enlarge
    else messageMenu(m);
  }));
  $("#attachPhoto").addEventListener("click", () => $("#photoPicker").click());
  $("#photoPicker").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (/^video\//.test(file.type)) { handleVideoPick(file); return; }
    if (!/^image\//.test(file.type)) { LL.toast("Please choose a photo or a video"); return; }
    try {
      const shot = await shrinkPhoto(file);
      confirmPhoto(shot);
    } catch (err) { console.warn(err); LL.toast("Couldn't read that photo"); }
  });
  loadVisiblePhotos(pane);
}

/* ----- photos ----- */
const photoCache = new Map();          // message id -> data URL
const MAX_PHOTO_CHARS = 690000;        // the rules cap the stored string at 700,000

// Shrink to something sensible for a chat: long side 1280px, then lower quality until it fits
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file).catch(async () => {
    const img = new Image(); img.src = URL.createObjectURL(file);
    await img.decode(); return img;
  });
  const w0 = bitmap.width || bitmap.naturalWidth, h0 = bitmap.height || bitmap.naturalHeight;
  let scale = Math.min(1, 1280 / Math.max(w0, h0));
  let quality = 0.72, dataUrl = "", w = 0, h = 0;
  for (let attempt = 0; attempt < 7; attempt++) {
    w = Math.max(1, Math.round(w0 * scale)); h = Math.max(1, Math.round(h0 * scale));
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_PHOTO_CHARS) break;
    if (quality > 0.45) quality -= 0.12; else scale *= 0.8;
  }
  if (dataUrl.length > MAX_PHOTO_CHARS) throw new Error("too big");
  return { dataUrl, w, h, kb: Math.round(dataUrl.length * 0.75 / 1024) };
}

/* ----- short video clips (kept small enough for the free plan) ----- */
const MAX_VIDEO_SECONDS = 10;
const MAX_CLIP_CHARS = 690000;
const videoCache = new Map();
const recorderType = () =>
  ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";

// Plays the chosen video silently into a canvas and re-records it at ~480p and a low bitrate.
// Takes about as long as the clip itself, so the caller shows progress.
async function shrinkVideo(file, onProgress) {
  const type = recorderType();
  if (!type) throw new Error("no-recorder");
  const url = URL.createObjectURL(file);
  const video = Object.assign(document.createElement("video"), { src: url, muted: false, playsInline: true, preload: "auto" });
  video.setAttribute("playsinline", "");
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error("unreadable"));
      setTimeout(() => rej(new Error("unreadable")), 15000);
    });
    // some videos (especially ones made by a phone's recorder) don't report their length
    const known = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : MAX_VIDEO_SECONDS;
    const dur = Math.min(known, MAX_VIDEO_SECONDS);
    const w0 = video.videoWidth || 640, h0 = video.videoHeight || 480;
    const scale = Math.min(1, 640 / Math.max(w0, h0));
    const w = Math.round(w0 * scale / 2) * 2, h = Math.round(h0 * scale / 2) * 2;
    // aim for a file that fits, with a little headroom
    const targetBytes = MAX_CLIP_CHARS * 0.72 * 0.86;
    const totalBits = Math.max(180000, Math.min(1200000, (targetBytes * 8) / dur));
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(24);

    // keep the sound, but play it silently: route audio through Web Audio instead of the speakers
    let audioCtx = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaElementSource(video).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch (e) { video.muted = true; }

    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: type,
      videoBitsPerSecond: Math.round(totalBits * 0.88),
      audioBitsPerSecond: Math.min(64000, Math.round(totalBits * 0.12))
    });
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { recorder.onstop = res; });

    let poster = null;
    const draw = () => {
      if (video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, w, h);
      if (!poster && video.currentTime > 0.1) poster = canvas.toDataURL("image/jpeg", 0.6);
      onProgress?.(Math.min(0.98, video.currentTime / dur));
      requestAnimationFrame(draw);
    };
    recorder.start(250);
    const startedAt = Date.now();
    await video.play();
    draw();
    await new Promise(res => {
      const stop = () => { try { video.pause(); } catch (e) { /* ignore */ } res(); };
      video.onended = stop;
      setTimeout(stop, dur * 1000 + 300);
    });
    recorder.stop();
    await done;
    const actualDur = Math.min(MAX_VIDEO_SECONDS, Math.max(0.5, (Date.now() - startedAt) / 1000));
    audioCtx?.close().catch(() => {});

    const blob = new Blob(chunks, { type });
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("read-failed"));
      fr.readAsDataURL(blob);
    });
    if (dataUrl.length > MAX_CLIP_CHARS) throw new Error("too-big");
    onProgress?.(1);
    return { dataUrl, type, poster: poster || canvas.toDataURL("image/jpeg", 0.6), w, h, dur: Math.round(actualDur * 10) / 10, kb: Math.round(dataUrl.length * 0.75 / 1024) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleVideoPick(file) {
  if (!recorderType()) { LL.toast("This device can't prepare videos. Try sending a photo instead."); return; }
  let cancelled = false;
  const dlg = openDialog(`
    <p class="eyebrow">Preparing video</p>
    <h2>Getting your clip ready…</h2>
    <p class="muted small">Only the first ${MAX_VIDEO_SECONDS} seconds are sent, made smaller so it's quick on data. This takes about as long as the clip.</p>
    <div class="progress"><span id="vidBar" style="width:4%"></span></div>
    <div class="share-actions"><button type="button" class="btn ghost" data-close>Cancel</button></div>`, null, () => { cancelled = true; });
  try {
    const clip = await shrinkVideo(file, p => { const bar = $("#vidBar", dlg); if (bar) bar.style.width = `${Math.round(p * 100)}%`; });
    dlg.close();
    if (!cancelled) confirmVideo(clip);
  } catch (e) {
    dlg.close();
    console.warn(e);
    LL.toast(e.message === "too-big" ? "That clip is too detailed to send on the free plan. Try a shorter one."
      : e.message === "unreadable" ? "Couldn't read that video"
      : "Couldn't prepare that video");
  }
}

function confirmVideo(clip) {
  openDialog(`
    <p class="eyebrow">Send video</p>
    <video class="photo-preview" src="${clip.dataUrl}" controls playsinline></video>
    <form id="videoForm" class="stack">
      <label>Caption (optional) <input id="videoCaption" maxlength="500" placeholder="Say something about it"></label>
      <p class="muted small">${clip.dur}s · ${clip.kb} KB · only members of this group can see it.</p>
      <div class="share-actions"><button class="btn" type="submit">Send video</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`, dlg => {
    $("#videoForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const caption = $("#videoCaption", dlg).value.trim();
      const ok = await run(async () => {
        const gid = S.current;
        const ref = doc(collection(db, "groups", gid, "messages"));
        const batch = writeBatch(db);
        batch.set(ref, { uid: S.user.uid, name: myName(), text: caption, kind: "video", w: clip.w, h: clip.h, dur: clip.dur, createdAt: serverTimestamp() });
        batch.set(doc(db, "groups", gid, "photos", ref.id), { uid: S.user.uid, image: clip.poster, createdAt: serverTimestamp() });
        batch.set(doc(db, "groups", gid, "videos", ref.id), { uid: S.user.uid, video: clip.dataUrl, type: clip.type, createdAt: serverTimestamp() });
        await batch.commit();
        photoCache.set(ref.id, clip.poster);
        videoCache.set(ref.id, clip.dataUrl);
      }, "Video sent");
      if (ok) dlg.close();
    });
  });
}

async function viewVideo(m) {
  let src = videoCache.get(m.id);
  if (!src) {
    LL.toast("Loading video…");
    try {
      const snap = await getDoc(doc(db, "groups", S.current, "videos", m.id));
      if (!snap.exists()) { LL.toast("That video is no longer available"); return; }
      src = snap.data().video;
      videoCache.set(m.id, src);
    } catch (e) { LL.toast(friendlyError(e)); return; }
  }
  openDialog(`
    <p class="eyebrow">${esc(m.name)} · ${when(m.createdAt)}</p>
    <video class="photo-full" src="${src}" controls autoplay playsinline></video>
    ${m.text ? `<p>${esc(m.text)}</p>` : ""}
    <div class="share-actions">
      <button type="button" class="btn ghost" id="videoShare">Share / save</button>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>`, dlg => {
    $("#videoShare", dlg).addEventListener("click", () => LL.shareMedia(src, `video-${m.id}`, `Video from ${m.name}`));
  });
}

function confirmPhoto(shot) {
  openDialog(`
    <p class="eyebrow">Send photo</p>
    <img class="photo-preview" src="${shot.dataUrl}" alt="Photo to send">
    <form id="photoForm" class="stack">
      <label>Caption (optional) <input id="photoCaption" maxlength="500" placeholder="Say something about it"></label>
      <p class="muted small">${shot.kb} KB · only members of this group can see it.</p>
      <div class="share-actions"><button class="btn" type="submit">Send photo</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`, dlg => {
    $("#photoForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const caption = $("#photoCaption", dlg).value.trim();
      const ok = await run(async () => {
        const gid = S.current;
        const ref = doc(collection(db, "groups", gid, "messages"));
        const batch = writeBatch(db);
        batch.set(ref, { uid: S.user.uid, name: myName(), text: caption, kind: "photo", w: shot.w, h: shot.h, createdAt: serverTimestamp() });
        batch.set(doc(db, "groups", gid, "photos", ref.id), { uid: S.user.uid, image: shot.dataUrl, createdAt: serverTimestamp() });
        await batch.commit();
        photoCache.set(ref.id, shot.dataUrl);
      }, "Photo sent");
      if (ok) dlg.close();
    });
  });
}

function photoMarkup(m) {
  const ratio = m.w && m.h ? (m.h / m.w) * 100 : 75;
  const cached = photoCache.get(m.id);
  const isVideo = m.kind === "video";
  return `<span class="msg-photo${isVideo ? " is-video" : ""}" data-photo="${m.id}" style="padding-bottom:${Math.min(140, Math.max(40, ratio))}%">
    ${cached ? `<img src="${cached}" alt="${isVideo ? "Video" : "Photo"} from ${esc(m.name)}">` : `<span class="photo-loading">${isVideo ? "🎬" : "📷"}</span>`}
    ${isVideo ? `<span class="play-badge" aria-hidden="true">▶</span><span class="dur-badge">${Math.round(m.dur || 0)}s</span>` : ""}
  </span>`;
}

// Photos download only when they scroll into view, so opening a chat stays light
function loadVisiblePhotos(pane) {
  const holders = $$(".msg-photo[data-photo]", pane).filter(el => !photoCache.has(el.dataset.photo));
  if (!holders.length) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target, id = el.dataset.photo;
      observer.unobserve(el);
      if (photoCache.has(id)) { showPhoto(el, photoCache.get(id)); continue; }
      getDoc(doc(db, "groups", S.current, "photos", id))
        .then(snap => {
          if (!snap.exists()) { el.innerHTML = `<span class="photo-loading">Photo unavailable</span>`; return; }
          photoCache.set(id, snap.data().image);
          showPhoto(el, snap.data().image);
        })
        .catch(() => { el.innerHTML = `<span class="photo-loading">Couldn't load</span>`; });
    }
  }, { root: $("#chatList"), rootMargin: "300px" });
  holders.forEach(el => observer.observe(el));
}
function showPhoto(el, src) {
  const msg = el.closest(".msg");
  el.innerHTML = `<img src="${src}" alt="Photo${msg ? " from " + (msg.querySelector(".msg-name")?.textContent || "you") : ""}">`;
  const list = $("#chatList");
  if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 200) list.scrollTop = list.scrollHeight;
}

function viewPhoto(m) {
  const src = photoCache.get(m.id);
  if (!src) { LL.toast("Still loading…"); return; }
  openDialog(`
    <p class="eyebrow">${esc(m.name)} · ${when(m.createdAt)}</p>
    <img class="photo-full" src="${src}" alt="Photo from ${esc(m.name)}">
    ${m.text ? `<p>${esc(m.text)}</p>` : ""}
    <div class="share-actions">
      <button type="button" class="btn ghost" id="photoShare">Share / save</button>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>`, dlg => {
    $("#photoShare", dlg).addEventListener("click", () => LL.sharePhoto(src, `Photo from ${m.name}`));
  });
}
// deletes a message and, for photos, the picture stored alongside it
async function deleteMessage(gid, m) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "groups", gid, "messages", m.id));
  if (m.kind === "photo" || m.kind === "video") batch.delete(doc(db, "groups", gid, "photos", m.id));
  if (m.kind === "video") batch.delete(doc(db, "groups", gid, "videos", m.id));
  await batch.commit();
  photoCache.delete(m.id); videoCache.delete(m.id);
}
async function postMessage({ text, kind, ref }) {
  const data = { uid: S.user.uid, name: myName(), text: text.slice(0, 2000), kind, createdAt: serverTimestamp(), ...(ref ? { ref } : {}) };
  try { await addDoc(collection(db, "groups", S.current, "messages"), data); if (kind !== "text") LL.toast("Shared with the group"); return true; }
  catch (e) { LL.toast(friendlyError(e)); return false; }
}
async function postToGroup(gid, { text, kind, ref }) {
  const data = { uid: S.user.uid, name: myName(), text: text.slice(0, 2000), kind, createdAt: serverTimestamp(), ...(ref ? { ref: ref.slice(0, 60) } : {}) };
  await addDoc(collection(db, "groups", gid, "messages"), data);
}
function messageMenu(m) {
  if (!m) return;
  const mine = m.uid === S.user.uid;
  const canDelete = mine || isLeader();
  openDialog(`
    <p class="eyebrow">${mine ? "Your message" : esc(m.name)}</p>
    <p class="menu-preview">${esc(m.text)}</p>
    <div class="menu-list">
      <button type="button" class="btn ghost" id="mCopy">Copy text</button>
      ${mine ? "" : `<button type="button" class="btn ghost" id="mReport">Report message</button>
                    <button type="button" class="btn ghost" id="mBlock">Block ${esc(m.name)}</button>`}
      ${canDelete ? `<button type="button" class="btn ghost danger" id="mDelete">Delete message</button>` : ""}
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>`, dlg => {
    $("#mCopy", dlg).addEventListener("click", () => { LL.copyText(m.text); dlg.close(); });
    $("#mReport", dlg)?.addEventListener("click", () => { dlg.close(); reportDialog("message", m); });
    $("#mBlock", dlg)?.addEventListener("click", () => { dlg.close(); blockPerson(m.uid, m.name); });
    $("#mDelete", dlg)?.addEventListener("click", async () => {
      if (!confirm("Delete this message for everyone?")) return;
      if (await run(() => deleteMessage(S.current, m), "Message deleted")) dlg.close();
    });
  });
}
function reportDialog(type, item) {
  const reasons = ["Unkind, hateful or bullying", "Scam or asking for money", "Sexual or inappropriate content", "False or harmful teaching", "Spam", "Something else"];
  openDialog(`
    <h2>Report ${type === "message" ? "message" : "prayer request"}</h2>
    <p class="muted small">The group's leaders will see your report. ${esc(item.name)} won't be told who reported it.</p>
    <form id="repForm" class="stack">
      ${reasons.map((r, i) => `<label class="switch-row"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? "checked" : ""}><span>${esc(r)}</span></label>`).join("")}
      <p class="muted small">If someone is in danger, contact local emergency services right away.</p>
      <div class="share-actions"><button class="btn" type="submit">Send report</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`, dlg => {
    $("#repForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const reason = $("input[name=reason]:checked", dlg).value;
      const ok = await run(() => addDoc(collection(db, "groups", S.current, "reports"), {
        reporterId: S.user.uid, targetType: type, targetId: item.id, targetUid: item.uid, targetName: item.name.slice(0, 40),
        targetText: item.text.slice(0, 2000), reason, createdAt: serverTimestamp()
      }), "Thank you. The leaders have been notified.");
      if (ok) { dlg.close(); if (confirm(`Also block ${item.name}? You won't see their messages.`)) blockPerson(item.uid, item.name); }
    });
  });
}
async function blockPerson(uid, name) {
  await run(() => setDoc(doc(db, "users", S.user.uid, "blocked", uid), { name: String(name).slice(0, 40), createdAt: serverTimestamp() }),
    `${name} is blocked. You won't see their messages or prayer requests.`);
}

/* ----- prayer wall ----- */
function renderPrayer(pane) {
  const me = S.user.uid;
  const list = S.prayers.filter(p => !S.blocked.has(p.uid));
  pane.innerHTML = `
    <form class="card stack" id="prayerForm">
      <label>Share a prayer request
        <textarea id="prayerInput" rows="3" maxlength="1000" placeholder="What would you like the group to pray about?"></textarea></label>
      <div class="row between wrap"><span class="muted small">Only members of this group can see it.</span><button class="btn" type="submit">Post request</button></div>
    </form>
    ${list.length ? `<ul class="prayer-list">${list.map(p => {
      const prayed = (p.prayedBy || []).includes(me), count = (p.prayedBy || []).length;
      return `<li class="card prayer ${p.answered ? "answered" : ""}">
        <div class="row between"><strong>${esc(p.name)}</strong><span class="muted small">${when(p.createdAt)}</span></div>
        <p class="prayer-text">${esc(p.text)}</p>
        ${p.answered ? `<p class="answered-badge">🎉 Answered prayer. Praise God!</p>` : ""}
        <div class="row gap wrap">
          <button type="button" class="btn small ${prayed ? "" : "ghost"}" data-pray="${p.id}" aria-pressed="${prayed}">🙏 ${prayed ? "I prayed" : "Pray"}${count ? ` · ${count}` : ""}</button>
          ${p.uid === me ? `<button type="button" class="btn ghost small" data-answered="${p.id}">${p.answered ? "Mark not answered" : "Mark answered"}</button>` : ""}
          <button type="button" class="link small" data-prayer-menu="${p.id}">More</button>
        </div>
      </li>`;
    }).join("")}</ul>` : `<p class="muted center">No prayer requests yet. “Pray one for another” (James 5:16).</p>`}`;
  $("#prayerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = $("#prayerInput").value.trim();
    if (!text) return;
    const ok = await run(() => addDoc(collection(db, "groups", S.current, "prayers"),
      { uid: me, name: myName(), text, answered: false, prayedBy: [], createdAt: serverTimestamp() }), "Prayer request shared");
    if (ok && $("#prayerInput")) $("#prayerInput").value = "";
  });
  $$("[data-pray]", pane).forEach(b => b.addEventListener("click", () => {
    const p = S.prayers.find(x => x.id === b.dataset.pray);
    const has = (p.prayedBy || []).includes(me);
    updateDoc(doc(db, "groups", S.current, "prayers", p.id), { prayedBy: has ? arrayRemove(me) : arrayUnion(me) }).catch(e => LL.toast(friendlyError(e)));
  }));
  $$("[data-answered]", pane).forEach(b => b.addEventListener("click", () => {
    const p = S.prayers.find(x => x.id === b.dataset.answered);
    updateDoc(doc(db, "groups", S.current, "prayers", p.id), { answered: !p.answered }).catch(e => LL.toast(friendlyError(e)));
  }));
  $$("[data-prayer-menu]", pane).forEach(b => b.addEventListener("click", () => {
    const p = S.prayers.find(x => x.id === b.dataset.prayerMenu);
    const mine = p.uid === me;
    openDialog(`
      <p class="eyebrow">${mine ? "Your prayer request" : esc(p.name)}</p>
      <p class="menu-preview">${esc(p.text)}</p>
      <div class="menu-list">
        ${mine ? "" : `<button type="button" class="btn ghost" id="pReport">Report</button><button type="button" class="btn ghost" id="pBlock">Block ${esc(p.name)}</button>`}
        ${mine || isLeader() ? `<button type="button" class="btn ghost danger" id="pDelete">Delete</button>` : ""}
        <button type="button" class="btn ghost" data-close>Close</button>
      </div>`, dlg => {
      $("#pReport", dlg)?.addEventListener("click", () => { dlg.close(); reportDialog("prayer", p); });
      $("#pBlock", dlg)?.addEventListener("click", () => { dlg.close(); blockPerson(p.uid, p.name); });
      $("#pDelete", dlg)?.addEventListener("click", async () => {
        if (!confirm("Delete this prayer request?")) return;
        if (await run(() => deleteDoc(doc(db, "groups", S.current, "prayers", p.id)), "Deleted")) dlg.close();
      });
    });
  }));
}

/* ----- group reading ----- */
function groupPlanInfo() {
  const code = S.group?.planCode;
  if (!code) return null;
  const p = LL.parsePlanCode(code);
  if (!p) return null;
  const def = p.id === "book" ? LL.buildBookPlan(p.book, p.perDay, p.from) : LL.PLANS.find(x => x.id === p.id);
  if (!def) return null;
  const start = new Date(p.start + "T00:00:00"), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = Math.min(Math.max(Math.round((today - start) / 864e5) + 1, 1), def.days.length);
  return { code, def, day, label: LL.dayLabel(def.days[day - 1]), started: today >= start };
}
function renderReading(pane) {
  const info = groupPlanInfo();
  const myPlanCode = LL.currentPlanCode();
  if (!info) {
    pane.innerHTML = `<article class="card">
      <h2>Read together</h2>
      ${isLeader()
        ? `<p>Choose a reading plan for the whole group. Everyone reads the same passage each day, and you'll see who has read ✓.</p>
           ${myPlanCode ? `<button type="button" class="btn" id="setPlan">Use my current plan (${esc(LL.currentPlanTitle())})</button>`
             : `<p class="muted small">First start a plan or book from the Today screen, then come back here to share it with the group.</p><button type="button" class="btn ghost" id="goPlans">Choose a plan</button>`}`
        : `<p class="muted">Your leader hasn't chosen a group reading plan yet.</p>`}
    </article>`;
    $("#setPlan")?.addEventListener("click", () => run(() => updateDoc(doc(db, "groups", S.current), { planCode: myPlanCode }), "Group reading plan set"));
    $("#goPlans")?.addEventListener("click", () => LL.show("plan"));
    return;
  }
  const readToday = S.members.filter(m => m.lastRead?.planCode === info.code && m.lastRead?.day >= info.day && m.lastRead?.date === todayKey());
  const meRead = readToday.some(m => m.id === S.user.uid);
  const onPlan = myPlanCode === info.code;
  pane.innerHTML = `
    <article class="card">
      <p class="eyebrow">Group plan · ${esc(info.def.title)}</p>
      <h2>${info.started ? `Day ${info.day} of ${info.def.days.length}` : "Starts soon"}</h2>
      <p class="plan-bar-title">${esc(info.label)}</p>
      <div class="progress"><span style="width:${Math.round(readToday.length / Math.max(S.members.length, 1) * 100)}%"></span></div>
      <p class="muted small">${readToday.length} of ${S.members.length} read today</p>
      <div class="row gap wrap">
        ${onPlan ? `<button type="button" class="btn" id="readNow">Read now</button>` : `<button type="button" class="btn" id="joinPlan">Follow this plan</button>`}
        <button type="button" class="btn ${meRead ? "" : "ghost"}" id="markRead" ${meRead ? "disabled data-keep-enabled" : ""}>${meRead ? "✓ You read today" : "Mark today as read"}</button>
      </div>
      ${onPlan ? "" : `<p class="muted small">Following the plan puts it on your Today screen and ticks you off here automatically when you finish.</p>`}
    </article>
    <article class="card">
      <p class="eyebrow">Today</p>
      <ul class="member-reads">${S.members.slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => {
        const done = readToday.some(r => r.id === m.id);
        return `<li class="${done ? "done" : ""}"><span>${done ? "✓" : "○"}</span> ${esc(m.name)}${m.id === S.user.uid ? " (you)" : ""}</li>`;
      }).join("")}</ul>
    </article>
    ${isLeader() ? `<p class="muted small center">
      ${myPlanCode && myPlanCode !== info.code ? `<button type="button" class="link" id="setPlan">Switch group to my plan</button> · ` : ""}
      <button type="button" class="link" id="clearPlan">Remove group plan</button></p>` : ""}`;
  $("#joinPlan")?.addEventListener("click", () => LL.handleJoinCode(info.code));
  $("#readNow")?.addEventListener("click", () => LL.openTodayReading());
  $("#markRead")?.addEventListener("click", () => markRead(info));
  $("#setPlan")?.addEventListener("click", () => run(() => updateDoc(doc(db, "groups", S.current), { planCode: myPlanCode }), "Group reading plan updated"));
  $("#clearPlan")?.addEventListener("click", () => { if (confirm("Remove the group reading plan?")) run(() => updateDoc(doc(db, "groups", S.current), { planCode: "" }), "Group plan removed"); });
}
function markRead(info, gid = S.current) {
  return run(() => updateDoc(doc(db, "groups", gid, "members", S.user.uid), { lastRead: { day: info.day, date: todayKey(), planCode: info.code } }), "Marked as read ✓");
}

/* ----- members & moderation ----- */
function renderMembers(pane) {
  const me = S.user.uid, owner = isOwner(), leader = isLeader();
  const roleLabel = r => r === "owner" ? "Leader" : r === "admin" ? "Co-leader" : "";
  const members = S.members.slice().sort((a, b) => ({ owner: 0, admin: 1, member: 2 }[a.role] - { owner: 0, admin: 1, member: 2 }[b.role]) || a.name.localeCompare(b.name));
  pane.innerHTML = `
    ${leader && S.reports.length ? `<article class="card reports">
      <p class="eyebrow">Reports to review (${S.reports.length})</p>
      ${S.reports.map(r => `<div class="report">
        <p><strong>${esc(r.targetName || "Someone")}</strong> · ${esc(r.reason)}</p>
        <p class="menu-preview">${esc(r.targetText || "")}</p>
        <div class="row gap wrap">
          <button type="button" class="btn ghost small danger" data-report-delete="${r.id}">Delete ${r.targetType === "prayer" ? "request" : "message"}</button>
          <button type="button" class="btn ghost small" data-report-member="${r.id}">Remove person</button>
          <button type="button" class="btn ghost small" data-report-dismiss="${r.id}">Dismiss</button>
        </div></div>`).join("")}
    </article>` : ""}
    <article class="card">
      <p class="eyebrow">${S.members.length} ${S.members.length === 1 ? "member" : "members"}</p>
      <ul class="member-list">${members.map(m => `
        <li>
          <span class="group-avatar small" aria-hidden="true">${esc(m.name.trim()[0]?.toUpperCase() || "?")}</span>
          <span class="grow">${esc(m.name)}${m.id === me ? " (you)" : ""} ${roleLabel(m.role) ? `<span class="tag">${roleLabel(m.role)}</span>` : ""}</span>
          ${m.id !== me && (owner || (leader && m.role === "member")) ? `<button type="button" class="link small" data-member="${m.id}">Manage</button>` : ""}
        </li>`).join("")}</ul>
    </article>
    <article class="card">
      <p class="eyebrow">Invite</p>
      <p>Share the link on WhatsApp, or give people the code <strong class="code">${esc(S.group.inviteCode)}</strong>.</p>
      <div class="row gap wrap">
        <button type="button" class="btn" id="inviteBtn2">Share invite link</button>
        ${owner ? `<button type="button" class="btn ghost" id="newCode">New invite code</button>` : ""}
      </div>
      ${owner ? `<p class="muted small">A new code stops the old link from working, for example if it was shared too widely.</p>` : ""}
    </article>
    ${leader ? `<article class="card">
      <p class="eyebrow">Group settings</p>
      <form id="gsForm" class="stack">
        <label>Name <input id="gsName" maxlength="40" required value="${esc(S.group.name)}"></label>
        <label>Description <input id="gsDesc" maxlength="300" value="${esc(S.group.description || "")}"></label>
        <button class="btn ghost" type="submit">Save</button>
      </form>
      ${S.bans.length ? `<p class="eyebrow" style="margin-top:14px">Removed & blocked from rejoining</p>
        <ul class="member-list">${S.bans.map(b => `<li><span class="grow">${esc(b.name || "Someone")}</span><button type="button" class="link small" data-unban="${b.id}">Allow back</button></li>`).join("")}</ul>` : ""}
    </article>` : ""}
    <div class="row center gap wrap" style="margin:10px 0 20px">
      ${owner ? `<button type="button" class="btn ghost danger" id="deleteGroup">Delete group</button>`
        : `<button type="button" class="btn ghost danger" id="leaveGroup">Leave group</button>`}
    </div>`;
  $("#inviteBtn2").addEventListener("click", shareInvite);
  $("#newCode")?.addEventListener("click", async () => {
    if (!confirm("Create a new invite code? The old link and code will stop working.")) return;
    const old = S.group.inviteCode; let code = newCode();
    for (let i = 0; i < 5 && (await getDoc(doc(db, "invites", code))).exists(); i++) code = newCode();
    run(async () => {
      const b = writeBatch(db);
      b.update(doc(db, "groups", S.current), { inviteCode: code });
      b.set(doc(db, "invites", code), { groupId: S.current, name: S.group.name });
      b.delete(doc(db, "invites", old));
      await b.commit();
    }, `New invite code: ${code}`);
  });
  $("#gsForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#gsName").value.trim(), description = $("#gsDesc").value.trim();
    run(async () => {
      const b = writeBatch(db);
      b.update(doc(db, "groups", S.current), { name, description });
      b.update(doc(db, "invites", S.group.inviteCode), { name });
      await b.commit();
    }, "Group updated");
  });
  $$("[data-member]", pane).forEach(b => b.addEventListener("click", () => manageMember(S.members.find(m => m.id === b.dataset.member))));
  $$("[data-unban]", pane).forEach(b => b.addEventListener("click", () => run(() => deleteDoc(doc(db, "groups", S.current, "bans", b.dataset.unban)), "They can join again with the invite link")));
  $$("[data-report-dismiss]", pane).forEach(b => b.addEventListener("click", () => run(() => deleteDoc(doc(db, "groups", S.current, "reports", b.dataset.reportDismiss)), "Report dismissed")));
  $$("[data-report-delete]", pane).forEach(b => b.addEventListener("click", async () => {
    const r = S.reports.find(x => x.id === b.dataset.reportDelete);
    await run(async () => {
      const b2 = writeBatch(db);
      b2.delete(doc(db, "groups", S.current, r.targetType === "prayer" ? "prayers" : "messages", r.targetId));
      if (r.targetType === "message") {
        b2.delete(doc(db, "groups", S.current, "photos", r.targetId));
        b2.delete(doc(db, "groups", S.current, "videos", r.targetId));
      }
      b2.delete(doc(db, "groups", S.current, "reports", r.id));
      await b2.commit();
    }, "Deleted");
  }));
  $$("[data-report-member]", pane).forEach(b => b.addEventListener("click", () => {
    const r = S.reports.find(x => x.id === b.dataset.reportMember);
    const m = S.members.find(x => x.id === r.targetUid);
    if (!m) { LL.toast("They're no longer in the group"); return; }
    manageMember(m);
  }));
  $("#leaveGroup")?.addEventListener("click", () => {
    if (!confirm(`Leave “${S.group.name}”? You can rejoin later with an invite link.`)) return;
    const gid = S.current;
    run(async () => { await deleteDoc(doc(db, "groups", gid, "members", me)); closeGroup(); }, "You left the group");
  });
  $("#deleteGroup")?.addEventListener("click", () => deleteGroupFlow());
}
function manageMember(m) {
  if (!m) return;
  const owner = isOwner();
  openDialog(`
    <p class="eyebrow">Manage member</p>
    <h2>${esc(m.name)}</h2>
    <div class="menu-list">
      ${owner && m.role === "member" ? `<button type="button" class="btn ghost" id="mmPromote">Make co-leader</button>` : ""}
      ${owner && m.role === "admin" ? `<button type="button" class="btn ghost" id="mmDemote">Remove co-leader role</button>` : ""}
      <button type="button" class="btn ghost danger" id="mmRemove">Remove from group</button>
      <button type="button" class="btn ghost danger" id="mmBan">Remove and block from rejoining</button>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>
    <p class="muted small">Co-leaders can delete messages, review reports and remove members.</p>`, dlg => {
    const gid = S.current;
    $("#mmPromote", dlg)?.addEventListener("click", async () => { if (await run(() => updateDoc(doc(db, "groups", gid, "members", m.id), { role: "admin" }), `${m.name} is now a co-leader`)) dlg.close(); });
    $("#mmDemote", dlg)?.addEventListener("click", async () => { if (await run(() => updateDoc(doc(db, "groups", gid, "members", m.id), { role: "member" }), "Role updated")) dlg.close(); });
    $("#mmRemove", dlg).addEventListener("click", async () => {
      if (!confirm(`Remove ${m.name} from the group?`)) return;
      if (await run(() => deleteDoc(doc(db, "groups", gid, "members", m.id)), `${m.name} was removed`)) dlg.close();
    });
    $("#mmBan", dlg).addEventListener("click", async () => {
      if (!confirm(`Remove ${m.name} and stop them rejoining with the invite link?`)) return;
      const ok = await run(async () => {
        await setDoc(doc(db, "groups", gid, "bans", m.id), { bannedBy: S.user.uid, createdAt: serverTimestamp(), name: m.name.slice(0, 40) });
        await deleteDoc(doc(db, "groups", gid, "members", m.id));
      }, `${m.name} was removed and blocked from rejoining`);
      if (ok) dlg.close();
    });
  });
}

// Delete in batches of up to 400 writes
async function deleteDocsIn(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => b.delete(r));
    await b.commit();
  }
}
async function wipeGroup(gid, inviteCode) {
  const sub = async name => (await getDocs(collection(db, "groups", gid, name))).docs.map(d => d.ref);
  await deleteDocsIn([...await sub("messages"), ...await sub("photos"), ...await sub("videos"), ...await sub("prayers"), ...await sub("reports"), ...await sub("bans")]);
  const members = (await getDocs(collection(db, "groups", gid, "members"))).docs;
  await deleteDocsIn(members.filter(d => d.id !== S.user.uid).map(d => d.ref));
  try { await deleteDoc(doc(db, "invites", inviteCode)); } catch (e) { /* already gone */ }
  await deleteDoc(doc(db, "groups", gid));
  await deleteDoc(doc(db, "groups", gid, "members", S.user.uid));
}
function deleteGroupFlow() {
  const g = S.group;
  const typed = prompt(`This permanently deletes “${g.name}”, including all messages and prayer requests, for everyone.\n\nType the group name to confirm:`);
  if (typed == null) return;
  if (typed.trim() !== g.name) { LL.toast("The name didn't match. The group was not deleted."); return; }
  const gid = S.current, code = g.inviteCode;
  clearSubs(unsubs); clearSubs(leaderUnsubs);
  run(async () => { await wipeGroup(gid, code); S.current = null; render(); }, "Group deleted");
}

/* ---------- profile & account ---------- */
function openProfile() {
  openDialog(`
    <p class="eyebrow">Your groups account</p>
    <h2>${esc(myName())}</h2>
    <p class="muted small">${esc(S.user.email || "")}</p>
    <form id="nameForm" class="stack">
      <label>Display name <input id="newName" maxlength="40" required value="${esc(myName())}"></label>
      <button class="btn ghost" type="submit">Save name</button>
    </form>
    ${S.blocked.size ? `<p class="eyebrow" style="margin-top:14px">Blocked people</p>
      <ul class="member-list">${[...S.blocked].map(([uid, name]) => `<li><span class="grow">${esc(name)}</span><button type="button" class="link small" data-unblock="${uid}">Unblock</button></li>`).join("")}</ul>` : ""}
    <div class="menu-list" style="margin-top:14px">
      <button type="button" class="btn ghost" id="signOutBtn">Sign out</button>
      <button type="button" class="btn ghost danger" id="deleteAccountBtn">Delete my account</button>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>`, dlg => {
    $("#nameForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("#newName", dlg).value.trim();
      const ok = await run(async () => {
        await updateDoc(doc(db, "users", S.user.uid), { name });
        await updateProfile(S.user, { displayName: name });
        const mine = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", S.user.uid)));
        for (const m of mine.docs) await updateDoc(m.ref, { name });
        S.profile = { ...S.profile, name };
      }, "Name updated");
      if (ok) { dlg.close(); render(); }
    });
    $$("[data-unblock]", dlg).forEach(b => b.addEventListener("click", async () => {
      await run(() => deleteDoc(doc(db, "users", S.user.uid, "blocked", b.dataset.unblock)), "Unblocked");
      dlg.close();
    }));
    $("#signOutBtn", dlg).addEventListener("click", async () => { dlg.close(); await signOut(auth); LL.toast("Signed out"); });
    $("#deleteAccountBtn", dlg).addEventListener("click", () => { dlg.close(); deleteAccountFlow(); });
  });
}
function deleteAccountFlow() {
  const owned = S.groups.filter(g => g.role === "owner");
  openDialog(`
    <h2>Delete your account?</h2>
    <p>This permanently deletes your groups account, your messages and prayer requests, and removes you from all groups.
      Your Bible reading, notes and plans on this phone are not affected.</p>
    ${owned.length ? `<p class="notice small">You lead ${owned.length === 1 ? "a group" : `${owned.length} groups`} (${owned.map(g => esc(g.group.name)).join(", ")}).
      ${owned.length === 1 ? "It" : "They"} will be deleted for everyone, including all messages.</p>` : ""}
    <form id="delForm" class="stack">
      <label>Enter your password to confirm <input id="delPassword" type="password" required autocomplete="current-password"></label>
      <div class="share-actions"><button class="btn danger" type="submit">Delete my account</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`, dlg => {
    $("#delForm", dlg).addEventListener("submit", async e => {
      e.preventDefault();
      const password = $("#delPassword", dlg).value;
      const ok = await run(async () => {
        const user = auth.currentUser;
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        clearSubs(homeUnsubs); closeGroup(false);
        for (const g of owned) await wipeGroup(g.id, g.group.inviteCode);
        // remove "I prayed" marks in groups they're still in
        for (const g of S.groups.filter(x => x.role !== "owner")) {
          try {
            const prayed = await getDocs(query(collection(db, "groups", g.id, "prayers"), where("prayedBy", "array-contains", user.uid)));
            for (const p of prayed.docs) await updateDoc(p.ref, { prayedBy: arrayRemove(user.uid) });
          } catch (err) { /* no longer a member */ }
        }
        const mineQ = name => getDocs(query(collectionGroup(db, name), where("uid", "==", user.uid)));
        await deleteDocsIn([...(await mineQ("messages")).docs.map(d => d.ref), ...(await mineQ("photos")).docs.map(d => d.ref), ...(await mineQ("videos")).docs.map(d => d.ref), ...(await mineQ("prayers")).docs.map(d => d.ref)]);
        await deleteDocsIn((await mineQ("members")).docs.map(d => d.ref));
        await deleteDocsIn((await getDocs(collection(db, "users", user.uid, "blocked"))).docs.map(d => d.ref));
        await deleteDoc(doc(db, "users", user.uid));
        await deleteUser(user);
      }, "Your account has been deleted");
      if (ok) dlg.close();
    });
  });
}

/* ---------- small dialog helper ---------- */
function openDialog(html, wire, onClose) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `<div class="dialog-body">${html}</div>`;   // not a <form>: dialogs contain their own forms
  document.body.appendChild(dlg);
  $$("[data-close]", dlg).forEach(b => b.addEventListener("click", () => dlg.close()));
  dlg.addEventListener("close", () => { dlg.remove(); if (onClose) onClose(); });
  wire?.(dlg);
  dlg.showModal();
  return dlg;
}

/* ---------- guidelines & privacy links (work anywhere) ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("[data-guidelines]")) { e.preventDefault(); $("#guidelinesSheet").showModal(); }
  if (e.target.closest("[data-privacy]")) { e.preventDefault(); LL.openExternal(`${LL.SITE}privacy.html`); }
});

/* ---------- bridge for the rest of the app ---------- */
// When the reader finishes a plan day, tick them off in groups that follow the same plan
window.addEventListener("ll:read", async e => {
  if (!db || !S.user || !S.profile || !e.detail?.complete) return;
  const code = LL.currentPlanCode();
  if (!code) return;
  for (const g of S.groups) {
    try {
      // read the group's current plan (a leader may have set it after this list was loaded)
      const snap = await getDoc(doc(db, "groups", g.id));
      if (!snap.exists()) continue;
      g.group = snap.data();
      if (g.group.planCode !== code) continue;
      await updateDoc(doc(db, "groups", g.id, "members", S.user.uid), { lastRead: { day: e.detail.day, date: todayKey(), planCode: code } });
    } catch (err) { /* offline or no longer a member */ }
  }
});

window.LLGroups = {
  render,
  openInvite,
  handleBack() {
    if (S.current && visible()) { closeGroup(); return true; }
    return false;
  },
  canPost: () => !!(db && S.user && S.profile && S.groups.length),
  pickGroupAndPost({ text, kind, ref }) {
    openDialog(`
      <p class="eyebrow">Post to a group</p>
      <p class="menu-preview">${esc(text)}</p>
      <div class="menu-list">${S.groups.map(g => `<button type="button" class="btn ghost" data-post-group="${g.id}">${esc(g.group.name)}</button>`).join("")}
        <button type="button" class="btn ghost" data-close>Cancel</button></div>`, dlg => {
      $$("[data-post-group]", dlg).forEach(b => b.addEventListener("click", async () => {
        const ok = await run(() => postToGroup(b.dataset.postGroup, { text, kind, ref }), "Posted to the group");
        if (ok) dlg.close();
      }));
    });
  }
};
if (LL.pendingGroupInvite) openInvite(LL.pendingGroupInvite);
if (visible()) render();
