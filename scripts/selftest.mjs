/**
 * Self test: what the module relies on in Foundry, its logic and its texts. It writes nothing.
 */

import {MODULE_ID, PARTNERS, TEMPLATES, TESTED_VERSIONS, esc, partnerApi, t} from "./config.mjs";
import {addEvent, fingerprint, levelOf, missedFor, naturalD20, needsNewSession, noteBlock, noteOf, renderPage,
  replaceNote, startSession, summarize, updatePresence} from "./logic.mjs";
import {textContext} from "./chronicle.mjs";

/**
 * Run all checks.
 * @returns {Promise<{problems: string[], checks: number, partners: string[]}>}
 */
async function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  const api = foundry.applications?.api;
  check(typeof api?.ApplicationV2 === "function" && typeof api?.HandlebarsApplicationMixin === "function",
    "SSC.SELFTEST.Application");
  check(typeof foundry.applications?.handlebars?.renderTemplate === "function", "SSC.SELFTEST.Templates");
  const ok = await fetch(`${TEMPLATES}/chronicle.hbs`, {method: "HEAD"}).then(r => r.ok).catch(() => false);
  check(ok, "SSC.SELFTEST.Template", {file: "chronicle.hbs"});

  // What the chronicle writes into: a journal with text pages, and the chat
  check(typeof JournalEntry?.implementation?.create === "function" && typeof JournalEntryPage === "function"
    && (CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML === 1), "SSC.SELFTEST.Journal");
  check(typeof ChatMessage?.implementation?.create === "function" && !!CONST.CHAT_MESSAGE_STYLES, "SSC.SELFTEST.Chat");
  check((CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER === 2) && (CONST.DOCUMENT_OWNERSHIP_LEVELS?.NONE === 0),
    "SSC.SELFTEST.Ownership");

  // What it listens to: the users, the sockets of showing things, combats and scenes
  check((typeof game.users?.activeGM !== "undefined") && (typeof game.user?.active === "boolean"), "SSC.SELFTEST.Users");
  check(!!game.socket && (typeof game.socket.on === "function") && (typeof game.socket.emit === "function"),
    "SSC.SELFTEST.Socket");
  check(!!game.combats && !!game.scenes && (typeof fromUuidSync === "function"), "SSC.SELFTEST.Documents");
  check(!!game.i18n && (typeof game.i18n.has === "function"), "SSC.SELFTEST.I18n");

  // The state in the world
  let stateOk = false;
  try {
    stateOk = typeof game.settings.get(MODULE_ID, "state") === "object";
  } catch {
    stateOk = false;
  }
  check(stateOk, "SSC.SELFTEST.State");

  // The logic on a small example
  const now = Date.UTC(2026, 10, 21, 19, 0);
  const session = startSession(3, now);
  addEvent(session, {k: "scene", name: "Harbor", sceneId: "a"}, now);
  addEvent(session, {k: "scene", name: "Harbor", sceneId: "a"}, now + 1000);
  addEvent(session, {k: "combat", combatId: "c", scene: "Harbor", rounds: 3, defeated: ["Rat", "Rat"], downed: []},
    now + 5 * 60000);
  addEvent(session, {k: "item", actorId: "x", actor: "Aria", name: "Potion", qty: 1}, now + 6 * 60000);
  addEvent(session, {k: "item", actorId: "x", actor: "Aria", name: "Potion", qty: 1}, now + 7 * 60000);
  updatePresence(session, [{id: "p", name: "Pia", active: true}], now + 20 * 60000);
  const summary = summarize(session.events);
  const html = renderPage({summary, note: "<b>", attendees: [], span: "x"}, textContext());
  const block = noteBlock("Hello", "Note");
  check((session.events.length === 3) && (summary.items[0].items[0].qty === 2) && (summary.fights[0].defeated[0].count === 2)
    && needsNewSession(session, now + 7 * 3600000, 6) && !needsNewSession(session, now + 3600000, 6)
    && naturalD20([{faces: 20, results: [{result: 20, active: true}]}]).max
    && (levelOf({details: {level: 4}}) === 4) && (levelOf({advancement: {level: 2}}) === 2)
    && (missedFor(session, "p", now + 30 * 60000, {minMinutes: 10})?.events.length === 3)
    && html.includes("&lt;b&gt;") && (noteOf(replaceNote("<p>x</p>", block)) === "Hello")
    && (fingerprint("a") !== fingerprint("b")), "SSC.SELFTEST.Logic");

  // Every text exists
  const keys = ["SSC.gear", "SSC.Title", "SSC.SELFTEST.Title", "SSC.Page.who", "SSC.Page.fights", "SSC.Page.highlights",
    "SSC.Page.levels", "SSC.Page.items", "SSC.Page.shown", "SSC.Page.scenes", "SSC.Page.photos", "SSC.Page.note",
    "SSC.Card.previously", "SSC.Missed.title", "SSC.Journal.name", "SSC.App.title"];
  const missing = keys.filter(key => !game.i18n.has(key));
  check(!missing.length, "SSC.SELFTEST.Texts", {keys: missing.join(", ")});

  // Sephral's other modules: only reported
  const partners = Object.entries(PARTNERS).filter(([, id]) => !!partnerApi(id)).map(([key]) => key);
  return {problems, checks, partners};
}

/**
 * Run the self test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], checks: number, partners: string[]}>}
 */
export async function runSelfTest({report = true} = {}) {
  const result = await checkAll();
  const {problems, checks, partners} = result;
  const summary = problems.length ? t("SSC.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SSC.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    const versions = t("SSC.SELFTEST.Version", {current: game.version, tested: TESTED_VERSIONS.core});
    const others = partners.length ? t("SSC.SELFTEST.Partners", {partners: partners.join(", ")}) : t("SSC.SELFTEST.NoPartners");
    let content = `<h3>${esc(t("SSC.SELFTEST.Title"))}</h3><p>${esc(summary)}</p><p><small>${esc(versions)}</small></p>`
      + `<p><small>${esc(others)}</small></p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id],
      speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return result;
}

/**
 * Tell the GM once when Foundry is newer than the version the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  if ( !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) return;
  const signature = `core ${game.version}`;
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SSC.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
