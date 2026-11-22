// Sample windows (api.samples, contract in samples.mjs): the chronicle window, a session page, the chat cards and the
// question of the module filled with a made-up game night, so translators and testers see every text in its place
// without playing a session first. Nothing here writes: no journal, setting or chat message is created, the buttons say
// that they do nothing. The partner modules are not needed, their numbers, loot and photos are made up too.
import {MODULE_ID, esc, t} from "./config.mjs";
import {ChronicleApp, buildContext} from "./app.mjs";
import {formatDate, formatSpan, textContext} from "./chronicle.mjs";
import {missedCard, previouslyCard, renderPage, startSession, summarize} from "./logic.mjs";
import {markSample, openSampleChat, openSampleHtml, sampleActions, sampleCast, sampleId, sampleText} from "./samples.mjs";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The text of a sample key of this module. */
function s(key, data) {
  return t(`SSC.Sample.${key}`, data);
}

/* -------------------------------------------- */
/*  The made-up night                           */
/* -------------------------------------------- */

/**
 * The facts of tonight, spread over the last two and a half hours. Same form as the facts the collector records.
 * @param {number} [now]
 * @returns {object[]}
 */
export function sampleFacts(now = Date.now()) {
  const at = minutes => now - minutes * MINUTE;
  const [ari, mira, tovin, sela] = sampleCast();
  const mill = sampleText("place");
  const bandit = sampleText("bandit");
  const facts = [
    {k: "scene", t: at(145), name: s("SceneRoad")},
    {k: "scene", t: at(120), name: mill},
    {k: "combat", t: at(100), scene: mill, rounds: 4, defeated: [sampleText("troll"), bandit, bandit, sampleText("wolf")], downed: [mira.name]},
    {k: "roll", t: at(98), kind: "crit", who: mira.name, flavor: sampleText("fireBolt")},
    {k: "roll", t: at(96), kind: "fumble", who: sela.name, flavor: sampleText("shortbow")},
    {k: "level", t: at(80), actor: ari.name, from: 4, to: 5},
    {k: "item", t: at(75), actor: ari.name, name: sampleText("longsword"), qty: 1},
    {k: "item", t: at(74), actor: sela.name, name: sampleText("shortbow"), qty: 2},
    {k: "shown", t: at(60), what: "journal", title: s("Letter")},
    {k: "shown", t: at(50), what: "image", title: s("Picture")},
    {k: "scene", t: at(40), name: s("SceneCellar")},
    {k: "roll", t: at(30), kind: "crit", who: tovin.name, flavor: sampleText("sacredFlame")}
  ];
  return facts.map((fact, index) => ({id: `ssc-sample-f${index + 1}`, ...fact}));
}

/** Made-up numbers, loot and photos like the partner modules deliver them. */
export function samplePartner() {
  return {
    combat: {fights: 1, rounds: 4, damage: 187, healing: 31, enemiesDefeated: 4, partyDowned: 1, criticalHits: 2,
      mvp: {names: [sampleCast()[1].name], value: 58}},
    loot: [{name: sampleText("longsword"), qty: 1}, {name: sampleText("shortbow"), qty: 2}],
    photos: [
      {src: "icons/environment/people/infantry-armored.webp", caption: sampleCast()[0].name},
      {src: "icons/creatures/magical/humanoid-giant-forest-blue.webp", caption: sampleText("troll")}
    ],
    used: ["combat", "album", "loot"]
  };
}

/** Who was at the table: the players with their heroes, one came late. */
export function sampleAttendees() {
  return sampleCast().filter(m => m.side === "party").map((m, index) =>
    ({id: m.id, name: m.player, character: m.name, late: index === 3, minutes: 150 - index * 20}));
}

/** The running session of the window. */
export function sampleSession(now = Date.now()) {
  const session = startSession(4, now - 150 * MINUTE);
  session.events = sampleFacts(now);
  session.last = now - 5 * MINUTE;
  session.note = s("Note");
  return session;
}

/** Past session pages for the list, oldest first. */
export function samplePages(now = Date.now(), count = 3) {
  const summary = summarize(sampleFacts(now));
  const pages = [];
  for ( let number = 1; number <= count; number++ ) {
    const started = now - ((count - number + 1) * 7 * DAY);
    pages.push({id: `ssc-sample-p${number}`, name: t("SSC.Page.title", {number, date: formatDate(started)}),
      flags: {session: {number, started}, attendees: sampleAttendees().slice(0, 4 - (number % 2)), summary}});
  }
  return pages;
}

/** The text of the page of tonight, with or without the partner data and the GM's line. */
export function samplePageHtml({partner = true, quiet = false, now = Date.now()} = {}) {
  const from = now - 150 * MINUTE;
  const summary = summarize(quiet ? [] : sampleFacts(now));
  return renderPage({summary, note: quiet ? "" : s("Note"), attendees: quiet ? [] : sampleAttendees(),
    partner: (partner && !quiet) ? samplePartner() : {}, span: formatSpan(from, now - 5 * MINUTE)}, textContext());
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

/** The chronicle window over made-up data. It writes nothing: buttons say so, a typed line is not saved. */
class SampleChronicleApp extends ChronicleApp {
  constructor(options, view) {
    super({...options, actions: sampleActions(ChronicleApp, [])});
    this.view = view;
    markSample(this);
  }

  async _prepareContext() {
    const {running, pages, player} = this.view;
    const now = Date.now();
    const open = running ? sampleSession(now) : null;
    const list = samplePages(now, pages);
    const last = list.at(-1);
    return buildContext({
      open,
      players: open ? sampleAttendees().map(a => a.name) : [],
      pages: list,
      noteValue: open ? open.note : (last ? s("Note") : ""),
      lastName: last?.name ?? "",
      active: !player,
      isGM: !player,
      hasJournal: pages > 0
    });
  }
}

function openWindow(key, view) {
  return async () => {
    const id = sampleId(MODULE_ID, key);
    await foundry.applications.instances.get(id)?.close({animate: false});
    const app = new SampleChronicleApp({id}, view);
    await app.render({force: true});
    return app;
  };
}

/* -------------------------------------------- */
/*  The entries                                 */
/* -------------------------------------------- */

/**
 * The sample windows of the module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows() {
  const windows = s("GroupWindows");
  const pages = s("GroupPages");
  const cards = s("GroupCards");
  const questions = s("GroupQuestions");
  const entries = [
    {id: "window-running", group: windows, label: s("WindowRunning"), open: openWindow("window-running", {running: true, pages: 3})},
    {id: "window-between", group: windows, label: s("WindowBetween"), open: openWindow("window-between", {running: false, pages: 3})},
    {id: "window-empty", group: windows, label: s("WindowEmpty"), open: openWindow("window-empty", {running: false, pages: 0})},
    {id: "window-player", group: windows, label: s("WindowPlayer"), open: openWindow("window-player", {running: false, pages: 3, player: true})}
  ];
  const page = (id, label, build) => entries.push({id, group: pages, label,
    open: () => openSampleHtml({moduleId: MODULE_ID, id, title: label, width: 560,
      body: () => `<div class="journal-entry-page"><div class="ssc-sample-page">${build()}</div></div>`})});
  page("page-full", s("PageFull"), () => samplePageHtml());
  page("page-plain", s("PagePlain"), () => samplePageHtml({partner: false}));
  page("page-quiet", s("PageQuiet"), () => samplePageHtml({quiet: true}));
  const card = (id, label, content, options = {}) => entries.push({id, group: cards, label,
    open: () => openSampleChat({moduleId: MODULE_ID, id, title: label, content, ...options})});
  const previously = (summary, note) => () => previouslyCard({number: 4, date: formatDate(Date.now() - 7 * DAY),
    summary, note, partner: samplePartner(), pageUuid: "JournalEntry.sample.JournalEntryPage.sample"}, textContext());
  const flags = kind => ({[MODULE_ID]: {kind}});
  card("card-previously", s("CardPrevious"), () => previously(summarize(sampleFacts()), s("Note"))(), {flags: flags("previously")});
  card("card-previously-quiet", s("CardPreviousQuiet"), () => previously(summarize([]), "")(), {flags: flags("previously")});
  card("card-missed-start", s("CardMissedStart"), () => missedCard({summary: summarize(sampleFacts().slice(0, 7)), firstTime: true},
    textContext()), {whisper: [game.user.id], flags: flags("missed")});
  card("card-missed-away", s("CardMissedAway"), () => missedCard({summary: summarize(sampleFacts().slice(7)), firstTime: true,
    last: {number: 3, date: formatDate(Date.now() - 7 * DAY), summary: summarize(sampleFacts().slice(0, 6))}}, textContext()),
  {whisper: [game.user.id], flags: flags("missed")});
  entries.push({id: "question-end", group: questions, label: s("QuestionEnd"),
    open: () => openSampleHtml({moduleId: MODULE_ID, id: "question-end", title: t("SSC.App.end"), width: 400,
      body: () => `<p>${esc(t("SSC.App.endConfirm"))}</p>`})});
  return entries;
}

export const __test__ = {sampleFacts, samplePartner, sampleAttendees, sampleSession, samplePages};
