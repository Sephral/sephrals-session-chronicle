/**
 * The life of a session on the active GM's client: facts come in, a session starts after a gap and ends with its page,
 * the players are told what happened before and what they missed. Everything is kept in one world setting, so another
 * GM can take over when the active GM changes. Only the active GM ever writes.
 */

import {MODULE_ID, PARTNERS, esc, isActiveGM, partnerApi, setting, t} from "./config.mjs";
import {addEvent, attendeesOf, closePresence, combatSnapshot, fingerprint, isIdle, lootOf, missedCard, missedFor,
  needsNewSession, noteBlock, noteOf, pageSort, photosOf, previouslyCard, removeEvent, renderPage, replaceNote, startSession,
  summarize, updatePresence, worthWriting, counted} from "./logic.mjs";
import {readerLanguage} from "./language.mjs";
import {trace} from "./trace.mjs";
import {countFeature} from "./usage.mjs";

/** The format of a text page: HTML. */
const HTML = 1;

/** Waiting for another module's API never takes longer than this. */
const PARTNER_TIMEOUT_MS = 5000;

/** The state is saved this long after the first change, so a burst of facts is one write. */
const SAVE_DELAY_MS = 1500;

/** What the world setting "state" holds. */
const EMPTY_STATE = {current: null, counter: 0, pending: "", closedUntilEmpty: false};

/** The state as this client works on it (the active GM), or null before it was loaded. */
let live = null;

/** Changes not yet saved. */
let dirty = false;
let saveTimer = null;
let saving = Promise.resolve();
/** Own saves on their way to the server: their setting hook must not drop the live copy. */
let inFlight = 0;

/** Everything that changes the state or the pages runs one after the other. */
let queue = Promise.resolve();

/** Called when something the window shows changed. */
let onChanged = () => {};

/**
 * Let the window know about changes.
 * @param {Function} callback
 */
export function setChangeListener(callback) {
  onChanged = callback;
}

/**
 * Run a task after all earlier ones.
 * @param {() => Promise<*>} task
 * @returns {Promise<*>}
 */
function serialize(task) {
  const run = queue.then(task, task);
  queue = run.catch(err => console.warn(`${MODULE_ID} |`, err));
  return run;
}

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

/**
 * The state from the world setting, without changing it.
 * @returns {object}
 */
export function storedState() {
  const stored = game.settings.get(MODULE_ID, "state");
  return foundry.utils.mergeObject(foundry.utils.deepClone(EMPTY_STATE), foundry.utils.deepClone(stored ?? {}),
    {inplace: false});
}

/**
 * The state to work on: the copy of this client, loaded once.
 * @returns {object}
 */
function working() {
  live ??= storedState();
  return live;
}

/**
 * The state for the window: what this client knows. The active GM works on its live copy, everyone else reads the
 * setting.
 * @returns {object}
 */
export function currentState() {
  return (live && isActiveGM()) ? live : storedState();
}

/**
 * The world setting changed. Whoever did not cause it forgets its copy and reads it again at the next use.
 */
export function onStateSetting() {
  if ( !dirty && !inFlight ) live = null;
  onChanged();
}

/**
 * Save the state soon (a burst of changes is one write) or at once.
 * @param {{now?: boolean}} [options]
 * @returns {Promise<void>}
 */
function save({now = false} = {}) {
  dirty = true;
  const run = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if ( !live || !dirty ) return saving;
    dirty = false;
    const copy = foundry.utils.deepClone(live);
    inFlight++;
    saving = saving.then(() => game.settings.set(MODULE_ID, "state", copy))
      .catch(err => console.warn(`${MODULE_ID} | The state could not be saved`, err))
      .finally(() => { inFlight--; });
    return saving;
  };
  if ( now ) return run();
  saveTimer ??= setTimeout(run, SAVE_DELAY_MS);
  return Promise.resolve();
}

/**
 * Write the state now (the page is closing, a test wants to read it).
 * @returns {Promise<void>}
 */
export function flush() {
  return serialize(() => save({now: true}));
}

/* -------------------------------------------- */
/*  Players                                     */
/* -------------------------------------------- */

/**
 * The players, active or not, with their characters.
 * @returns {{id: string, name: string, character: string, active: boolean}[]}
 */
function playerList() {
  return game.users.filter(user => !user.isGM).map(user => ({id: user.id, name: user.name,
    character: user.character?.name ?? "", active: user.active}));
}

/**
 * Is a player online, or does the GM want to be recorded alone?
 * @returns {boolean}
 */
function mayRecord() {
  return setting("recording") && (setting("recordAlone") || game.users.some(user => !user.isGM && user.active));
}

/* -------------------------------------------- */
/*  Facts                                       */
/* -------------------------------------------- */

/**
 * A fact came in (active GM). It is kept when recording is on and somebody is playing.
 * @param {object} fact   {k, ...}
 * @returns {Promise<object|null>}
 */
export function record(fact) {
  if ( !isActiveGM() || !mayRecord() ) return Promise.resolve(null);
  return serialize(async () => {
    const now = Date.now();
    await ensureSession(now);
    const state = working();
    const session = state.current;
    updatePresence(session, playerList(), now);
    const stored = addEvent(session, fact, now);
    session.last = Math.max(session.last, now);
    session.lastFact = now;
    if ( stored ) session.dirtyPage = true;
    trace.add(stored ? "fact" : "fact-merged", {kind: fact.k, id: stored?.id});
    state.closedUntilEmpty = false;
    await save();
    await postPendingPreviously();
    onChanged();
    return stored;
  }).catch(err => {
    trace.add("record-failed", {kind: fact?.k, message: err?.message});
    return null;
  });
}

/**
 * Take a fact out of the open session (GM).
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export function removeFact(id) {
  return serialize(async () => {
    const session = working().current;
    if ( !session || !removeEvent(session, id) ) return false;
    session.dirtyPage = true;
    countFeature(MODULE_ID, "factRemoved");
    await save({now: true});
    onChanged();
    return true;
  });
}

/* -------------------------------------------- */
/*  Sessions                                    */
/* -------------------------------------------- */

/**
 * Make sure a session is open at a time: a new one starts after a gap, and the one before gets its page.
 * @param {number} now
 * @returns {Promise<void>}
 */
async function ensureSession(now) {
  const state = working();
  if ( !needsNewSession(state.current, now, setting("gapHours")) ) return;
  if ( state.current ) await finalize(state, {reason: "gap"});
  state.current = startSession(state.counter + 1, now);
  state.current.lastFact = now;
  trace.add("session-start", {number: state.current.number});
}

/**
 * Close the open session: its page is written for the last time. A session nobody took part in leaves no page.
 * @param {object} state
 * @param {{reason: string, manual?: boolean}} options
 * @returns {Promise<JournalEntryPage|null>}
 */
async function finalize(state, {reason, manual = false}) {
  const session = state.current;
  if ( !session ) return null;
  closePresence(session, session.last);
  let page = null;
  if ( worthWriting(session) ) {
    session.final = true;
    page = await writeSessionPage(session, {manual});
    if ( page ) {
      state.counter = Math.max(state.counter, session.number);
      state.pending = page.id;
    }
  }
  trace.add("session-end", {number: session.number, reason, page: page?.id ?? null});
  state.current = null;
  return page;
}

/**
 * End the open session now and write its page (GM, active).
 * @returns {Promise<JournalEntryPage|null>}
 */
export function endSession() {
  return serialize(async () => {
    const state = working();
    if ( !state.current ) return null;
    const page = await finalize(state, {reason: "button", manual: true});
    state.closedUntilEmpty = true;
    countFeature(MODULE_ID, "sessionEnded");
    await save({now: true});
    onChanged();
    return page;
  });
}

/**
 * Write the page of the open session now, without ending it (active GM).
 * @param {{manual?: boolean}} [options]
 * @returns {Promise<JournalEntryPage|null>}
 */
export function writeNow({manual = true} = {}) {
  return serialize(async () => {
    const session = working().current;
    if ( !session || !worthWriting(session) ) return null;
    const page = await writeSessionPage(session, {manual});
    await save({now: true});
    onChanged();
    return page;
  });
}

/**
 * The GM's note for the open session, or for the page of the last session when none is open (GM, active).
 * @param {string} text
 * @param {string} [pageId]   A finished page to change instead
 * @returns {Promise<void>}
 */
export function setNote(text, pageId = "") {
  return serialize(async () => {
    const state = working();
    const note = String(text ?? "").slice(0, 2000);
    if ( state.current && !pageId ) {
      state.current.note = note;
      state.current.dirtyPage = true;
      if ( state.current.pageId ) await writeSessionPage(state.current, {manual: true});
      await save({now: true});
    }
    else {
      const page = journal()?.pages.get(pageId || lastPageId());
      if ( page ) await changePageNote(page, note);
    }
    countFeature(MODULE_ID, "noteSaved");
    onChanged();
  });
}

/**
 * Put a note into a finished page: its text, its flag, and the fingerprint when the page was still the written one.
 * @param {JournalEntryPage} page
 * @param {string} note
 */
async function changePageNote(page, note) {
  const content = page.text?.content ?? "";
  const pristine = fingerprint(content) === page.getFlag(MODULE_ID, "hash");
  const next = replaceNote(content, noteBlock(note, t("SSC.Page.note")));
  await page.update({"text.content": next, [`flags.${MODULE_ID}.note`]: note});
  if ( pristine ) await syncHash(page);
}

/**
 * Remember the fingerprint of the text as Foundry stored it (it may clean the HTML), so a later edit by hand can be
 * told from the text the module wrote.
 * @param {JournalEntryPage} page
 */
async function syncHash(page) {
  const stored = fingerprint(page.text?.content ?? "");
  if ( stored !== page.getFlag(MODULE_ID, "hash") ) await page.update({[`flags.${MODULE_ID}.hash`]: stored});
}

/* -------------------------------------------- */
/*  Presence                                    */
/* -------------------------------------------- */

/**
 * Look at who is online (active GM): the attendance, the page when the last player left, "Previously" for the first
 * ones and "What you missed" for those who come late.
 * @returns {Promise<void>}
 */
export function scanPresence() {
  if ( !isActiveGM() || !setting("recording") ) return Promise.resolve();
  return serialize(async () => {
    const now = Date.now();
    const players = playerList();
    const anyone = players.some(player => player.active);
    const state = working();
    if ( !anyone ) state.closedUntilEmpty = false;
    if ( !anyone && !state.current ) return;
    if ( !anyone ) {
      const session = state.current;
      const {left} = updatePresence(session, players, now);
      if ( left.length ) {
        // Everybody went home: the page is written and the session stays open until the gap runs out
        if ( session.dirtyPage || !session.pageId ) await writeIfWorth(session);
        await save({now: true});
        onChanged();
      }
      return;
    }
    if ( state.closedUntilEmpty && !state.current ) return;
    await ensureSession(now);
    const session = state.current;
    const {joined} = updatePresence(session, players, now);
    session.last = now;
    if ( joined.length ) session.dirtyPage = true;
    await save();
    await postPendingPreviously();
    if ( setting("missed") ) {
      for ( const id of joined ) await sendMissed(session, id, now);
    }
    onChanged();
  });
}

/**
 * Write the page of a session when it is worth one.
 * @param {object} session
 */
async function writeIfWorth(session) {
  if ( worthWriting(session) ) await writeSessionPage(session, {manual: false});
}

/**
 * Called every minute on the active GM's client: a session quiet for a while gets its page.
 * @returns {Promise<void>}
 */
export function tick() {
  if ( !isActiveGM() || !setting("recording") ) return Promise.resolve();
  return scanPresence().then(() => serialize(async () => {
    const session = working().current;
    if ( !session || !setting("autoPage") || !session.dirtyPage ) return;
    if ( !isIdle({last: session.lastFact ?? session.last}, Date.now(), setting("idleMinutes")) ) return;
    await writeIfWorth(session);
    await save({now: true});
    onChanged();
  }));
}

/* -------------------------------------------- */
/*  Journal and pages                           */
/* -------------------------------------------- */

/**
 * The Chronicle journal, or null before the first page.
 * @returns {JournalEntry|null}
 */
export function journal() {
  const id = setting("journal");
  const byId = id ? game.journal.get(id) : null;
  return byId ?? game.journal.find(entry => entry.getFlag(MODULE_ID, "chronicle")) ?? null;
}

/**
 * The Chronicle journal, created when missing.
 * @returns {Promise<JournalEntry>}
 */
async function ensureJournal() {
  const found = journal();
  if ( found ) return found;
  const entry = await JournalEntry.implementation.create({
    name: t("SSC.Journal.name"),
    ownership: {default: setting("playerAccess") ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    flags: {[MODULE_ID]: {chronicle: true}}
  });
  await game.settings.set(MODULE_ID, "journal", entry.id);
  return entry;
}

/**
 * The session pages of the journal in order.
 * @returns {JournalEntryPage[]}
 */
export function sessionPages() {
  const entry = journal();
  if ( !entry ) return [];
  return entry.pages.filter(page => page.getFlag(MODULE_ID, "session")).sort((a, b) =>
    (a.getFlag(MODULE_ID, "session.number") ?? 0) - (b.getFlag(MODULE_ID, "session.number") ?? 0));
}

/**
 * The id of the newest session page, or an empty string.
 * @returns {string}
 */
function lastPageId() {
  return sessionPages().at(-1)?.id ?? "";
}

/**
 * Let players read the Chronicle or not (the setting changed).
 * @returns {Promise<void>}
 */
export async function applyPlayerAccess() {
  if ( !game.user.isGM || !isActiveGM() ) return;
  const entry = journal();
  if ( !entry ) return;
  const level = setting("playerAccess") ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  if ( entry.ownership.default !== level ) await entry.update({"ownership.default": level});
}

/**
 * A date for a title or a line, in the language of the user.
 * @param {number} ms
 * @returns {string}
 */
export function formatDate(ms) {
  try {
    return new Date(ms).toLocaleDateString(readerLanguage(), {year: "numeric", month: "long", day: "numeric"});
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * "Saturday 21 November 2026, 19:02 to 22:40".
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
export function formatSpan(from, to) {
  const lang = readerLanguage();
  try {
    const day = new Date(from).toLocaleDateString(lang, {weekday: "long", year: "numeric", month: "long", day: "numeric"});
    const time = ms => new Date(ms).toLocaleTimeString(lang, {hour: "2-digit", minute: "2-digit"});
    return t("SSC.Page.span", {day, from: time(from), to: time(to)});
  } catch {
    return `${new Date(from).toISOString()} - ${new Date(to).toISOString()}`;
  }
}

/**
 * The tools the pure text functions need: localize, and a number for the reader.
 * @returns {{t: Function, num: Function}}
 */
export function textContext() {
  const lang = readerLanguage();
  const num = value => {
    try {
      return new Intl.NumberFormat(lang, {maximumFractionDigits: 1}).format(value);
    } catch {
      return String(Math.round(value * 10) / 10);
    }
  };
  return {t, num};
}

/* -------------------------------------------- */
/*  Partner modules                             */
/* -------------------------------------------- */

/**
 * Wait for a promise, but not for long.
 * @param {Promise<*>} promise
 * @returns {Promise<*>}
 */
function withTimeout(promise) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(undefined), PARTNER_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * What Sephral's other modules know about the time of a session: the combat totals of Combat Log & Stats, the photos
 * of Campaign Album and the loot of Loot Ledger. Each is read only when that module is active, and a failure only
 * leaves its part out.
 * @param {number} from
 * @param {number} to
 * @returns {Promise<{combat: object|null, loot: object[]|null, photos: object[]|null, used: string[]}>}
 */
export async function partnerData(from, to) {
  const result = {combat: null, loot: null, photos: null, used: []};
  if ( !setting("partnerData") ) return result;
  const combat = partnerApi(PARTNERS.combat);
  if ( typeof combat?.sessionTotals === "function" ) {
    try {
      const totals = await withTimeout(combat.sessionTotals({from, to}));
      result.combat = combatSnapshot(totals);
      result.used.push("combat");
    } catch(err) {
      trace.add("partner-failed", {partner: "combat", message: err?.message});
    }
  }
  const album = partnerApi(PARTNERS.album);
  if ( typeof album?.photos === "function" ) {
    try {
      const photos = photosOf(album.photos(), from, to);
      result.photos = photos.length ? photos : null;
      result.used.push("album");
    } catch(err) {
      trace.add("partner-failed", {partner: "album", message: err?.message});
    }
  }
  const loot = partnerApi(PARTNERS.loot);
  if ( typeof loot?.entries === "function" ) {
    try {
      const items = lootOf(loot.entries(), from, to);
      result.loot = items.length ? items : null;
      result.used.push("loot");
    } catch(err) {
      trace.add("partner-failed", {partner: "loot", message: err?.message});
    }
  }
  return result;
}

/* -------------------------------------------- */
/*  The page                                    */
/* -------------------------------------------- */

/**
 * Write (or update) the page of a session. A page that was edited by hand since it was written keeps its text, only
 * the data behind it is updated.
 * @param {object} session
 * @param {{manual?: boolean}} [options]
 * @returns {Promise<JournalEntryPage|null>}
 */
async function writeSessionPage(session, {manual = false} = {}) {
  const entry = await ensureJournal();
  const from = session.started;
  const to = Math.max(session.last, session.lastFact ?? 0, from);
  const summary = summarize(session.events);
  const partner = await partnerData(from, to + 30 * 60 * 1000);
  const attendees = attendeesOf(session);
  const ctx = textContext();
  const content = renderPage({summary, note: session.note, attendees, partner, span: formatSpan(from, to)}, ctx);
  const data = {
    session: {number: session.number, started: from, ended: to, final: !!session.final},
    summary, attendees, partner, note: session.note,
    hash: fingerprint(content)
  };
  const name = t("SSC.Page.title", {number: session.number, date: formatDate(from)});
  let page = session.pageId ? entry.pages.get(session.pageId) : null;
  if ( !page ) {
    [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name, type: "text", sort: pageSort(session.number),
      text: {content, format: HTML},
      flags: {[MODULE_ID]: data}
    }]);
    session.pageId = page.id;
    await syncHash(page);
  }
  else {
    const edited = fingerprint(page.text?.content ?? "") !== page.getFlag(MODULE_ID, "hash");
    const update = {name, [`flags.${MODULE_ID}`]: edited ? {...data, hash: page.getFlag(MODULE_ID, "hash")} : data};
    if ( !edited ) update["text.content"] = content;
    await page.update(update);
    if ( !edited ) await syncHash(page);
  }
  session.pageHash = page.getFlag(MODULE_ID, "hash");
  session.dirtyPage = false;
  session.written = (session.written ?? 0) + 1;
  trace.add("page-written", {number: session.number, manual, final: !!session.final, facts: session.events.length});
  if ( manual ) countFeature(MODULE_ID, "pageManual");
  else countFeature(MODULE_ID, "pageWritten");
  return page;
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

/**
 * Post the card "Previously" for a session page, when one is waiting and somebody is playing.
 * @returns {Promise<void>}
 */
async function postPendingPreviously() {
  const state = working();
  if ( !state.pending ) return;
  if ( setting("previously") === "off" ) {
    state.pending = "";
    await save();
    return;
  }
  if ( !game.users.some(user => !user.isGM && user.active) && !setting("recordAlone") ) return;
  const pageId = state.pending;
  state.pending = "";
  await save();
  await postPreviouslyCard(pageId, {manual: false});
}

/**
 * Post the card "Previously" for a session page.
 * @param {string} pageId
 * @param {{manual?: boolean, mode?: string}} [options]   mode: "everyone", "gm" (default: the setting)
 * @returns {Promise<ChatMessage|null>}
 */
export async function postPreviouslyCard(pageId, {manual = false, mode} = {}) {
  const page = journal()?.pages.get(pageId);
  if ( !page ) return null;
  const flags = (page.flags?.[MODULE_ID] ?? {});
  const choice = mode ?? setting("previously");
  const html = previouslyCard({number: flags.session?.number ?? 0, date: formatDate(flags.session?.started ?? Date.now()),
    summary: flags.summary ?? summarize([]), note: flags.note ?? noteOf(page.text?.content), partner: flags.partner ?? {},
    pageUuid: (choice !== "gm" && !setting("playerAccess")) ? "" : page.uuid}, textContext());
  const message = await ChatMessage.implementation.create({
    content: html,
    speaker: {alias: t("SSC.Title")},
    whisper: (choice === "gm") ? [game.user.id] : [],
    flags: {[MODULE_ID]: {kind: "previously", pageId}}
  });
  trace.add("previously", {pageId, manual, mode: choice});
  if ( manual ) countFeature(MODULE_ID, "previouslyReposted");
  else countFeature(MODULE_ID, "previouslyPosted");
  return message;
}

/**
 * Post the card "Previously" again for a page, on request of the GM.
 * @param {string} pageId
 * @param {{mode?: string}} [options]
 * @returns {Promise<ChatMessage|null>}
 */
export function repostPreviously(pageId, options = {}) {
  return serialize(() => postPreviouslyCard(pageId, {...options, manual: true}));
}

/**
 * Whisper what a player missed to that player.
 * @param {object} session
 * @param {string} userId
 * @param {number} now
 * @returns {Promise<void>}
 */
async function sendMissed(session, userId, now) {
  const missed = missedFor(session, userId, now, {minMinutes: setting("missedMinutes")});
  if ( !missed ) return;
  const summary = summarize(missed.events);
  let last = null;
  if ( missed.firstTime ) {
    // Somebody who also missed the session before gets its story with it
    const previous = sessionPages().at(-1);
    const flags = (previous?.flags?.[MODULE_ID] ?? null);
    const wasThere = flags?.attendees?.some(a => a.id === userId);
    if ( flags && !wasThere ) {
      last = {number: flags.session?.number ?? 0, date: formatDate(flags.session?.started ?? now), summary: flags.summary};
    }
  }
  const html = missedCard({summary, firstTime: missed.firstTime, last}, textContext());
  await ChatMessage.implementation.create({
    content: html,
    speaker: {alias: t("SSC.Title")},
    whisper: [userId],
    flags: {[MODULE_ID]: {kind: "missed"}}
  });
  trace.add("missed", {userId, facts: missed.events.length, firstTime: missed.firstTime});
  countFeature(MODULE_ID, "missedSent");
}

/* -------------------------------------------- */
/*  For the window, the API and tests           */
/* -------------------------------------------- */

/**
 * Pretend time has passed: the open session looks as if its last activity was this long ago (GM, tests).
 * @param {number} hours
 * @returns {Promise<void>}
 */
export function ageSession(hours) {
  return serialize(async () => {
    const session = working().current;
    if ( !session ) return;
    const shift = hours * 3600 * 1000;
    session.started -= shift;
    session.last -= shift;
    session.lastFact = (session.lastFact ?? session.last) - shift;
    for ( const event of session.events ) event.t -= shift;
    for ( const entry of Object.values(session.attendance) ) {
      entry.spans = entry.spans.map(([from, to]) => [from - shift, to === null ? null : to - shift]);
    }
    await save({now: true});
    onChanged();
  });
}

/**
 * A readable line for a fact (the window shows these).
 * @param {object} fact
 * @returns {string}
 */
export function factText(fact) {
  const summary = summarize([fact]);
  if ( fact.k === "scene" ) return t("SSC.Fact.scene", {name: fact.name});
  if ( fact.k === "combat" ) {
    const line = summary.fights[0];
    return t("SSC.Fact.combat", {scene: line.scene || t("SSC.Text.somewhere"), rounds: counted(t, "SSC.Text.rounds", line.rounds),
      defeated: line.defeated.reduce((sum, f) => sum + f.count, 0)});
  }
  if ( fact.k === "level" ) return t("SSC.Fact.level", {actor: fact.actor, level: fact.to});
  if ( fact.k === "item" ) return t("SSC.Fact.item", {actor: fact.actor, name: fact.name, count: fact.qty ?? 1});
  if ( fact.k === "shown" ) return t(fact.what === "journal" ? "SSC.Fact.shownJournal" : "SSC.Fact.shownImage", {title: fact.title});
  if ( fact.k === "roll" ) return t(fact.kind === "crit" ? "SSC.Fact.crit" : "SSC.Fact.fumble", {who: fact.who});
  return esc(fact.k);
}

/**
 * The GM's note of a session page, as plain text.
 * @param {JournalEntryPage} page
 * @returns {string}
 */
export function noteOfPage(page) {
  const flag = page.getFlag(MODULE_ID, "note");
  return (typeof flag === "string") ? flag : noteOf(page.text?.content);
}
