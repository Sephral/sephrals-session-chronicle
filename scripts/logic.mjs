/**
 * Rules of the chronicle without Foundry: when a session starts and ends, which facts are kept and how they are merged,
 * who was at the table, what a late player missed and how a page or a card reads. Kept pure so Node can test them.
 * No AI is involved anywhere: every sentence is built from a fixed template and the facts.
 */

/** The kinds of facts the chronicle keeps. */
export const KINDS = ["scene", "combat", "level", "item", "shown", "roll"];

/** More facts than this in one session: the oldest rolls go first, then the oldest facts. */
export const EVENT_LIMIT = 600;

/** A player who arrives later than this after the start of the session counts as late. */
export const LATE_MINUTES = 15;

/** Items of these types are no loot: what a class, a background or a spell gives is not "gained". */
export const NOT_LOOT = new Set(["class", "subclass", "background", "race", "species", "feat", "spell", "action",
  "ability", "melee", "ranged", "lore", "condition", "effect", "heritage", "ancestry", "deity", "feature", "talent",
  "power", "edge", "hindrance", "archetype", "skill", "career", "advancement", "passive", "maneuver", "attack",
  "boon", "bane", "talent", "taxonomy", "gift", "origin", "class-feature"]);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/* -------------------------------------------- */
/*  Sessions                                    */
/* -------------------------------------------- */

/**
 * Does activity at a time start a new session? It does when there is no open session, or when the last activity of the
 * session lies longer ago than the gap.
 * @param {{last?: number, started?: number}|null|undefined} session
 * @param {number} now             Real time in ms
 * @param {number} gapHours
 * @returns {boolean}
 */
export function needsNewSession(session, now, gapHours) {
  if ( !session ) return true;
  const last = Number(session.last ?? session.started);
  if ( !Number.isFinite(last) ) return true;
  return (now - last) > (Math.max(Number(gapHours) || 0, 0) * HOUR);
}

/**
 * Has a session been quiet long enough for its page to be written?
 * @param {{last?: number}} session
 * @param {number} now
 * @param {number} idleMinutes
 * @returns {boolean}
 */
export function isIdle(session, now, idleMinutes) {
  return (now - Number(session?.last ?? now)) >= (Math.max(Number(idleMinutes) || 0, 1) * MINUTE);
}

/**
 * A new, empty session.
 * @param {number} number
 * @param {number} now
 * @returns {object}
 */
export function startSession(number, now) {
  return {id: `s${number}-${now.toString(36)}`, number, started: now, last: now, seq: 0, events: [], attendance: {},
    note: "", pageId: "", written: 0, pageHash: "", final: false};
}

/**
 * Is a session worth a page? It is when something happened or a player was there.
 * @param {object|null} session
 * @returns {boolean}
 */
export function worthWriting(session) {
  if ( !session ) return false;
  return (session.events?.length > 0) || (Object.keys(session.attendance ?? {}).length > 0);
}

/**
 * The sort key of a page: sessions are numbered, so the number orders them.
 * @param {number} number
 * @returns {number}
 */
export function pageSort(number) {
  return Number(number) * 1000;
}

/* -------------------------------------------- */
/*  Facts                                       */
/* -------------------------------------------- */

/**
 * Add a fact to a session and merge it with what is already there. Mutates the session.
 *
 * - scene: the same scene twice in a row is one fact
 * - shown: the same thing shown twice within 30 seconds is one fact
 * - level: one fact per actor and level
 * - roll: one fact per chat message
 * - combat: one fact per combat
 * - item: the same item for the same actor adds to its quantity
 *
 * @param {object} session
 * @param {{k: string, t?: number}} event
 * @param {number} now
 * @param {{limit?: number}} [options]
 * @returns {object|null}   The fact as stored, or null when it was left out or merged
 */
export function addEvent(session, event, now, {limit = EVENT_LIMIT} = {}) {
  if ( !KINDS.includes(event?.k) ) return null;
  const events = session.events;
  const fact = {...event, t: Number.isFinite(event.t) ? event.t : now};
  switch ( fact.k ) {
    case "scene": {
      const last = [...events].reverse().find(e => e.k === "scene");
      if ( last && (last.sceneId === fact.sceneId) && (last.name === fact.name) ) return null;
      break;
    }
    case "shown": {
      const same = events.find(e => (e.k === "shown") && (e.what === fact.what) && (e.title === fact.title)
        && (Math.abs(fact.t - e.t) < 30000));
      if ( same ) return null;
      break;
    }
    case "level":
      if ( events.some(e => (e.k === "level") && (e.actorId === fact.actorId) && (e.to === fact.to)) ) return null;
      break;
    case "roll":
      if ( fact.messageId && events.some(e => (e.k === "roll") && (e.messageId === fact.messageId)) ) return null;
      break;
    case "combat":
      if ( fact.combatId && events.some(e => (e.k === "combat") && (e.combatId === fact.combatId)) ) return null;
      break;
    case "item": {
      const same = events.find(e => (e.k === "item") && (e.actorId === fact.actorId) && (e.name === fact.name));
      if ( same ) {
        same.qty = (Number(same.qty) || 1) + (Number(fact.qty) || 1);
        return null;
      }
      fact.qty = Number(fact.qty) || 1;
      break;
    }
  }
  session.seq = (session.seq ?? 0) + 1;
  fact.id = `e${session.seq}`;
  events.push(fact);
  while ( events.length > limit ) {
    const index = events.findIndex(e => e.k === "roll");
    events.splice(index >= 0 ? index : 0, 1);
  }
  session.last = Math.max(session.last ?? 0, fact.t);
  return fact;
}

/**
 * Take a fact out of a session (the GM found it wrong or unwanted). Mutates the session.
 * @param {object} session
 * @param {string} id
 * @returns {boolean}
 */
export function removeEvent(session, id) {
  const index = session.events.findIndex(e => e.id === id);
  if ( index < 0 ) return false;
  session.events.splice(index, 1);
  return true;
}

/**
 * The natural result of the first d20 of a roll: 20, 1 or something else.
 * @param {{faces: number, results: {result: number, active?: boolean, discarded?: boolean}[]}[]} dice
 * @returns {{natural: number|null, max: boolean, min: boolean}}
 */
export function naturalD20(dice) {
  const die = (dice ?? []).find(d => Number(d?.faces) === 20);
  const results = (die?.results ?? []).filter(r => (r.active !== false) && !r.discarded);
  const natural = results.length ? Number(results[0].result) : null;
  return {natural, max: natural === 20, min: natural === 1};
}

/**
 * Plain text out of a chat flavor (it may hold HTML), cut to a length.
 * @param {string} html
 * @param {number} [max]
 * @returns {string}
 */
export function plainText(html, max = 60) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return (text.length > max) ? `${text.slice(0, max - 1).trim()}…` : text;
}

/**
 * The level of an actor in any game system the module knows: dnd5e and Pathfinder 2e (`details.level`, a number or
 * `{value}`), Crucible (`advancement.level`), and a few common places.
 * @param {object} system   actor.system
 * @param {number} [fallback]   actor.level, when the document has one
 * @returns {number|null}
 */
export function levelOf(system, fallback) {
  const candidates = [system?.details?.level, system?.advancement?.level, system?.attributes?.level,
    system?.level, system?.details?.level?.value, system?.attributes?.level?.value, system?.level?.value, fallback];
  for ( const value of candidates ) {
    const number = Number(value?.value ?? value);
    if ( Number.isFinite(number) && (number > 0) ) return number;
  }
  return null;
}

/**
 * Is an item of this type something a character gained as loot?
 * @param {string} type
 * @returns {boolean}
 */
export function isLootType(type) {
  return !NOT_LOOT.has(String(type ?? "").toLowerCase());
}

/**
 * The name of an item that players may read: an item its system marks as unidentified shows the cover name, or
 * nothing when there is none.
 * @param {{name?: string, system?: object}} item
 * @returns {string}   Empty when the item must be left out
 */
export function visibleItemName(item) {
  const system = item?.system;
  if ( system?.identified === false ) return String(system.unidentified?.name ?? "").trim();
  return String(item?.name ?? "");
}

/* -------------------------------------------- */
/*  Who was there                               */
/* -------------------------------------------- */

/**
 * Bring the attendance up to date. `users` are the players the game knows, active or not. A player who is online has
 * an open span, a player who left a closed one. Mutates the session.
 * @param {object} session
 * @param {{id: string, name: string, character?: string, active: boolean}[]} users
 * @param {number} now
 * @returns {{joined: string[], left: string[]}}
 */
export function updatePresence(session, users, now) {
  const joined = [];
  const left = [];
  for ( const user of users ) {
    const entry = session.attendance[user.id];
    if ( user.active ) {
      if ( !entry ) {
        session.attendance[user.id] = {name: user.name, character: user.character ?? "", spans: [[now, null]]};
        joined.push(user.id);
      }
      else {
        entry.name = user.name;
        if ( user.character ) entry.character = user.character;
        if ( entry.spans.at(-1)?.[1] !== null ) {
          entry.spans.push([now, null]);
          joined.push(user.id);
        }
      }
    }
    else if ( entry && (entry.spans.at(-1)?.[1] === null) ) {
      entry.spans.at(-1)[1] = now;
      left.push(user.id);
    }
  }
  return {joined, left};
}

/**
 * Close every open span (the session ends). Mutates the session.
 * @param {object} session
 * @param {number} now
 */
export function closePresence(session, now) {
  for ( const entry of Object.values(session.attendance) ) {
    const span = entry.spans.at(-1);
    if ( span && (span[1] === null) ) span[1] = Math.max(now, span[0]);
  }
}

/**
 * The players who took part, in the order they arrived.
 * @param {object} session
 * @returns {{id: string, name: string, character: string, late: boolean, minutes: number}[]}
 */
export function attendeesOf(session) {
  const now = session.last ?? Date.now();
  return Object.entries(session.attendance ?? {})
    .map(([id, entry]) => {
      const first = entry.spans[0]?.[0] ?? session.started;
      const minutes = entry.spans.reduce((sum, [from, to]) => sum + Math.max((to ?? now) - from, 0), 0) / MINUTE;
      return {id, name: entry.name, character: entry.character ?? "", first, minutes: Math.round(minutes),
        late: (first - session.started) > (LATE_MINUTES * MINUTE) && (session.events.some(e => e.t < first))};
    })
    .sort((a, b) => a.first - b.first)
    .map(({first, ...rest}) => rest);
}

/**
 * What a player missed: the facts since they left, or since the start of the session when they came late. null when
 * they were away for less than the minimum or nothing happened.
 * @param {object} session
 * @param {string} userId         The player who just connected (an open span)
 * @param {number} now
 * @param {{minMinutes?: number}} [options]
 * @returns {{since: number, events: object[], firstTime: boolean}|null}
 */
export function missedFor(session, userId, now, {minMinutes = 10} = {}) {
  const entry = session.attendance?.[userId];
  if ( !entry ) return null;
  const closed = entry.spans.filter(span => span[1] !== null);
  const firstTime = entry.spans.length === 1;
  const since = firstTime ? session.started : closed.at(-1)[1];
  const currentStart = entry.spans.at(-1)[0];
  if ( (currentStart - since) < (Math.max(minMinutes, 0) * MINUTE) ) return null;
  const events = session.events.filter(e => (firstTime ? (e.t >= since) : (e.t > since)) && (e.t <= now));
  return events.length ? {since, events, firstTime} : null;
}

/* -------------------------------------------- */
/*  Summaries                                   */
/* -------------------------------------------- */

/**
 * Merge facts into what a page or card tells.
 * @param {object[]} events
 * @returns {{scenes: object[], fights: object[], levelUps: object[], items: object[], shown: object[], highlights: object[]}}
 */
export function summarize(events) {
  const scenes = [];
  const fights = [];
  const levelUps = [];
  const items = new Map();
  const shown = [];
  const highlights = [];
  for ( const e of [...(events ?? [])].sort((a, b) => a.t - b.t) ) {
    if ( e.k === "scene" ) {
      const same = scenes.find(s => s.name === e.name);
      if ( same ) same.visits++;
      else scenes.push({name: e.name, visits: 1});
    }
    else if ( e.k === "combat" ) {
      const defeated = new Map();
      for ( const name of e.defeated ?? [] ) defeated.set(name, (defeated.get(name) ?? 0) + 1);
      fights.push({scene: e.scene ?? "", rounds: Number(e.rounds) || 0,
        defeated: [...defeated].map(([name, count]) => ({name, count})), downed: [...new Set(e.downed ?? [])]});
    }
    else if ( e.k === "level" ) levelUps.push({actor: e.actor, from: e.from ?? null, to: e.to});
    else if ( e.k === "item" ) {
      const list = items.get(e.actor) ?? [];
      list.push({name: e.name, qty: Number(e.qty) || 1});
      items.set(e.actor, list);
    }
    else if ( e.k === "shown" ) shown.push({what: e.what, title: e.title});
    else if ( e.k === "roll" ) highlights.push({kind: e.kind, who: e.who, flavor: e.flavor ?? ""});
  }
  return {scenes, fights, levelUps, items: [...items].map(([actor, list]) => ({actor, items: list})), shown, highlights};
}

/**
 * Is there nothing in a summary?
 * @param {object} summary
 * @returns {boolean}
 */
export function isEmpty(summary) {
  return !summary || ["scenes", "fights", "levelUps", "items", "shown", "highlights"].every(k => !summary[k]?.length);
}

/**
 * The combat totals of Combat Log & Stats in the small form the chronicle stores, or null without fights.
 * @param {object|null} totals
 * @returns {object|null}
 */
export function combatSnapshot(totals) {
  if ( !(Number(totals?.fights) > 0) ) return null;
  const n = value => Math.max(Number(value) || 0, 0);
  const mvp = (totals.awards ?? []).find(award => award?.key === "mvp");
  return {fights: n(totals.fights), rounds: n(totals.rounds), damage: n(totals.damage), healing: n(totals.healing),
    enemiesDefeated: n(totals.enemiesDefeated), partyDowned: n(totals.partyDowned), criticalHits: n(totals.criticalHits),
    mvp: mvp?.names?.length ? {names: mvp.names.map(String), value: n(mvp.value)} : null};
}

/**
 * The loot of Loot Ledger entries in a time span: items that came into the party's hands.
 * @param {object[]} entries
 * @param {number} from
 * @param {number} to
 * @returns {{name: string, qty: number}[]}
 */
export function lootOf(entries, from, to) {
  const found = new Map();
  for ( const entry of entries ?? [] ) {
    if ( !entry?.item?.name || !["add", "award"].includes(entry.kind) ) continue;
    if ( (entry.time < from) || (entry.time > to) ) continue;
    if ( entry.from?.kind && (entry.from.kind !== "outside") ) continue;
    found.set(entry.item.name, (found.get(entry.item.name) ?? 0) + (Number(entry.item.quantity) || 1));
  }
  return [...found].map(([name, qty]) => ({name, qty}));
}

/**
 * Photos of Campaign Album in a time span, the newest last.
 * @param {object[]} photos
 * @param {number} from
 * @param {number} to
 * @param {number} [max]
 * @returns {{src: string, caption: string}[]}
 */
export function photosOf(photos, from, to, max = 6) {
  return (photos ?? [])
    .filter(photo => photo?.src && (photo.time >= from) && (photo.time <= to))
    .sort((a, b) => a.time - b.time)
    .slice(0, max)
    .map(photo => ({src: photo.src, caption: String(photo.caption ?? "")}));
}

/* -------------------------------------------- */
/*  Text                                        */
/* -------------------------------------------- */

/**
 * Escape a value for HTML.
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
    "'": "&#39;"})[ch]);
}

/**
 * The words around a list of names: "Aria", "Aria and Bram", "Aria, Bram and Cole".
 * @param {string[]} names
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function joinNames(names, t) {
  if ( names.length < 2 ) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${t("SSC.Text.and")} ${names.at(-1)}`;
}

/**
 * The text for a count with a singular and a plural: key + "One" or key + "Other".
 * @param {(key: string, data?: object) => string} t
 * @param {string} key
 * @param {number} count
 * @returns {string}
 */
export function counted(t, key, count) {
  return t(`${key}${Number(count) === 1 ? "One" : "Other"}`, {count});
}

/**
 * The lines of every part of a summary, as plain text (not yet escaped). Each part has a `page` list, one entry per
 * item, and a `card` list of shorter lines for chat cards.
 * @param {object} summary
 * @param {{t: Function, num?: Function}} ctx
 * @returns {Record<string, {page: string[], card: string[]}>}
 */
export function sectionLines(summary, ctx) {
  const {t} = ctx;
  const list = names => joinNames(names, t);
  const foes = fight => list(fight.defeated.map(f => (f.count > 1 ? t("SSC.Text.times", {name: f.name, count: f.count}) : f.name)));
  const scenes = {page: [], card: []};
  for ( const scene of summary.scenes ?? [] ) {
    scenes.page.push(scene.visits > 1 ? t("SSC.Text.visits", {name: scene.name, count: scene.visits}) : scene.name);
  }
  if ( scenes.page.length ) {
    const names = summary.scenes.map(s => s.name);
    const shown = names.slice(0, 5);
    const more = names.length - shown.length;
    scenes.card.push(more > 0
      ? t("SSC.Text.scenesMore", {names: shown.join(", "), count: more})
      : t("SSC.Text.scenes", {names: list(shown)}));
  }
  const fights = {page: [], card: []};
  for ( const fight of summary.fights ?? [] ) {
    const where = fight.scene || t("SSC.Text.somewhere");
    const rounds = counted(t, "SSC.Text.rounds", fight.rounds);
    let line = fight.defeated.length ? t("SSC.Text.fight", {scene: where, rounds, foes: foes(fight)})
      : t("SSC.Text.fightNone", {scene: where, rounds});
    if ( fight.downed.length ) line += ` ${t("SSC.Text.downed", {names: list(fight.downed)})}`;
    fights.page.push(line);
    fights.card.push(line);
  }
  const levels = {page: [], card: []};
  for ( const up of summary.levelUps ?? [] ) {
    const line = t("SSC.Text.level", {actor: up.actor, level: up.to});
    levels.page.push(line);
    levels.card.push(line);
  }
  const items = {page: [], card: []};
  for ( const gained of summary.items ?? [] ) {
    const names = gained.items.map(i => (i.qty > 1 ? t("SSC.Text.times", {name: i.name, count: i.qty}) : i.name));
    const line = t("SSC.Text.gained", {actor: gained.actor, items: list(names)});
    items.page.push(line);
    items.card.push(line);
  }
  const shown = {page: [], card: []};
  for ( const s of summary.shown ?? [] ) {
    shown.page.push(t(s.what === "journal" ? "SSC.Text.shownJournal" : "SSC.Text.shownImage", {title: s.title}));
  }
  if ( shown.page.length ) {
    const pictures = summary.shown.filter(s => s.what !== "journal").length;
    const handouts = summary.shown.length - pictures;
    const parts = [];
    if ( handouts ) parts.push(counted(t, "SSC.Text.handouts", handouts));
    if ( pictures ) parts.push(counted(t, "SSC.Text.pictures", pictures));
    shown.card.push(t("SSC.Text.shownCard", {parts: list(parts)}));
  }
  const highlights = {page: [], card: []};
  for ( const h of summary.highlights ?? [] ) {
    const flavor = h.flavor ? ` (${h.flavor})` : "";
    const line = t(h.kind === "crit" ? "SSC.Text.crit" : "SSC.Text.fumble", {who: h.who, flavor});
    highlights.page.push(line);
    highlights.card.push(line);
  }
  return {scenes, fights, levels, items, shown, highlights};
}

/** The sections of a page in order, with the key of their title and the summary part they show. */
export const SECTIONS = [
  {id: "fights", icon: "fa-swords"},
  {id: "highlights", icon: "fa-dice-d20"},
  {id: "levels", icon: "fa-arrow-up-right-dots"},
  {id: "items", icon: "fa-gem"},
  {id: "shown", icon: "fa-image"},
  {id: "scenes", icon: "fa-map"}
];

/**
 * The lines of the combat totals of Combat Log & Stats.
 * @param {object|null} combat   See combatSnapshot
 * @param {{t: Function, num: Function}} ctx
 * @returns {string[]}
 */
export function combatLines(combat, {t, num}) {
  if ( !(combat?.fights > 0) ) return [];
  const lines = [t("SSC.Combat.overview", {fights: counted(t, "SSC.Combat.fights", combat.fights),
    rounds: counted(t, "SSC.Combat.rounds", combat.rounds)})];
  if ( (combat.damage > 0) && (combat.healing > 0) ) {
    lines.push(t("SSC.Combat.damageHealing", {damage: num(combat.damage), healing: num(combat.healing)}));
  }
  else if ( combat.damage > 0 ) lines.push(t("SSC.Combat.damage", {damage: num(combat.damage)}));
  else if ( combat.healing > 0 ) lines.push(t("SSC.Combat.healing", {healing: num(combat.healing)}));
  if ( combat.enemiesDefeated > 0 ) lines.push(counted(t, "SSC.Combat.defeated", combat.enemiesDefeated));
  if ( combat.partyDowned > 0 ) lines.push(counted(t, "SSC.Combat.downed", combat.partyDowned));
  if ( combat.criticalHits > 0 ) lines.push(counted(t, "SSC.Combat.crits", combat.criticalHits));
  if ( combat.mvp?.names?.length ) {
    lines.push(t("SSC.Combat.mvp", {names: joinNames(combat.mvp.names, t), amount: num(combat.mvp.value)}));
  }
  return lines;
}

/** The paragraph of the GM's note in a page. Foundry strips HTML comments from journal text, so the block itself is the marker. */
const NOTE_RE = /<blockquote class="ssc-note">[\s\S]*?<\/blockquote>/;

/**
 * The block of the GM's note for a page, empty without a note.
 * @param {string} note
 * @param {string} heading
 * @returns {string}
 */
export function noteBlock(note, heading) {
  const text = String(note ?? "").trim();
  if ( !text ) return "";
  const paragraphs = text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<blockquote class="ssc-note"><h3>${esc(heading)}</h3>${paragraphs}</blockquote>`;
}

/**
 * Put a new note into the text of a page: it replaces the old note, or goes to the top when the page has none.
 * An empty block takes the note out.
 * @param {string} content
 * @param {string} block   See noteBlock
 * @returns {string}
 */
export function replaceNote(content, block) {
  const text = String(content ?? "");
  if ( NOTE_RE.test(text) ) return text.replace(NOTE_RE, () => block);
  const wrapper = '<div class="ssc-page">';
  return text.startsWith(wrapper) ? wrapper + block + text.slice(wrapper.length) : block + text;
}

/**
 * The note in the text of a page, as plain text with blank lines between paragraphs, or an empty string.
 * @param {string} content
 * @returns {string}
 */
export function noteOf(content) {
  const found = NOTE_RE.exec(String(content ?? ""));
  if ( !found ) return "";
  return found[0].replace(/<h3>.*?<\/h3>/g, "").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").trim();
}

/**
 * The HTML of a session page.
 * @param {object} data
 * @param {object} data.summary
 * @param {string} data.note
 * @param {{name: string, character: string, late: boolean}[]} data.attendees
 * @param {{combat?: object|null, loot?: object[]|null, photos?: object[]|null}} [data.partner]
 * @param {string} data.span          "Saturday 21 November 2026, 19:02 to 22:40"
 * @param {{t: Function, num: Function}} ctx
 * @returns {string}
 */
export function renderPage({summary, note, attendees, partner = {}, span}, ctx) {
  const {t} = ctx;
  const lines = sectionLines(summary, ctx);
  const html = [`<div class="ssc-page">`, noteBlock(note, t("SSC.Page.note")), `<p class="ssc-span">${esc(span)}</p>`];
  const heading = (id, icon) => `<h2><i class="fa-solid ${icon}"></i> ${esc(t(`SSC.Page.${id}`))}</h2>`;
  const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
  if ( attendees.length ) {
    const names = attendees.map(a => {
      let text = a.character ? t("SSC.Text.playerAs", {player: a.name, character: a.character}) : a.name;
      if ( a.late ) text += ` ${t("SSC.Text.late")}`;
      return text;
    });
    html.push(heading("who", "fa-users"), list(names));
  }
  for ( const {id, icon} of SECTIONS ) {
    const part = lines[id].page;
    if ( id === "fights" ) {
      const totals = combatLines(partner.combat, ctx);
      if ( !part.length && !totals.length ) continue;
      html.push(heading(id, icon));
      if ( part.length ) html.push(list(part));
      if ( totals.length ) html.push(`<p class="ssc-totals">${totals.map(esc).join(" ")}</p>`);
      continue;
    }
    if ( id === "items" && partner.loot?.length ) {
      const found = partner.loot.map(i => (i.qty > 1 ? t("SSC.Text.times", {name: i.name, count: i.qty}) : i.name));
      const merged = [...part, t("SSC.Text.found", {items: joinNames(found, t)})];
      html.push(heading(id, icon), list(merged));
      continue;
    }
    if ( !part.length ) continue;
    html.push(heading(id, icon), list(part));
  }
  if ( partner.photos?.length ) {
    html.push(heading("photos", "fa-camera"), `<div class="ssc-photos">`);
    for ( const photo of partner.photos ) {
      html.push(`<figure><img src="${esc(photo.src)}" alt="${esc(photo.caption)}">`
        + (photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : "") + `</figure>`);
    }
    html.push(`</div>`);
  }
  if ( isEmpty(summary) && !attendees.length && !partner.combat && !partner.photos?.length ) {
    html.push(`<p class="ssc-quiet">${esc(t("SSC.Page.quiet"))}</p>`);
  }
  html.push(`<p class="ssc-foot">${esc(t("SSC.Page.foot"))}</p>`, `</div>`);
  return html.join("");
}

/**
 * The lines of the "Previously" card: the fights first, then the big moments, level ups, loot, shown things and the
 * way through the scenes. At most `limit` lines, with a note about the rest.
 * @param {object} summary
 * @param {{t: Function, num: Function}} ctx
 * @param {number} [limit]
 * @returns {string[]}
 */
export function cardLines(summary, ctx, limit = 7) {
  const lines = sectionLines(summary, ctx);
  const all = SECTIONS.flatMap(({id}) => lines[id].card);
  return all.length > limit ? all.slice(0, limit) : all;
}

/**
 * The chat card "Previously" for everyone.
 * @param {object} data
 * @param {number} data.number
 * @param {string} data.date
 * @param {object} data.summary
 * @param {string} data.note
 * @param {{combat?: object|null}} [data.partner]
 * @param {string} data.pageUuid
 * @param {{t: Function, num: Function}} ctx
 * @returns {string}
 */
export function previouslyCard({number, date, summary, note, partner = {}, pageUuid}, ctx) {
  const {t} = ctx;
  const lines = cardLines(summary, ctx);
  const html = [`<div class="ssc-card ssc-previously">`,
    `<header><i class="fa-solid fa-book-open"></i><div><h3>${esc(t("SSC.Card.previously"))}</h3>`,
    `<small>${esc(t("SSC.Card.session", {number, date}))}</small></div></header>`];
  const text = String(note ?? "").trim();
  if ( text ) html.push(`<blockquote>${esc(text).replace(/\n/g, "<br>")}</blockquote>`);
  if ( lines.length ) html.push(`<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  else if ( !text ) html.push(`<p class="ssc-quiet">${esc(t("SSC.Card.quiet"))}</p>`);
  if ( pageUuid ) {
    html.push(`<button type="button" data-ssc-open="${esc(pageUuid)}"><i class="fa-solid fa-scroll"></i> `
      + `${esc(t("SSC.Card.open"))}</button>`);
  }
  html.push("</div>");
  return html.join("");
}

/**
 * The private chat card "What you missed".
 * @param {object} data
 * @param {object} data.summary          Of the facts the player missed
 * @param {number} data.minutes          How long the player was away
 * @param {boolean} data.firstTime
 * @param {{number: number, date: string, summary: object, pageUuid: string}|null} [data.last]   Last session, when the player missed it
 * @param {{t: Function, num: Function}} ctx
 * @returns {string}
 */
export function missedCard({summary, firstTime, last = null}, ctx) {
  const {t} = ctx;
  const lines = cardLines(summary, ctx, 8);
  const html = [`<div class="ssc-card ssc-missed">`,
    `<header><i class="fa-solid fa-hourglass-half"></i><div><h3>${esc(t("SSC.Missed.title"))}</h3>`,
    `<small>${esc(t(firstTime ? "SSC.Missed.sinceStart" : "SSC.Missed.sinceAway"))}</small></div></header>`,
    `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`];
  if ( last ) {
    const before = cardLines(last.summary, ctx, 4);
    if ( before.length ) {
      html.push(`<h4>${esc(t("SSC.Missed.last", {number: last.number, date: last.date}))}</h4>`,
        `<ul>${before.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
    }
  }
  html.push(`<small class="ssc-private">${esc(t("SSC.Missed.private"))}</small></div>`);
  return html.join("");
}

/**
 * A short, stable fingerprint of a text (cyrb53, 14 hex digits), to see whether somebody edited a page by hand.
 * @param {string} text
 * @returns {string}
 */
export function fingerprint(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for ( let i = 0; i < text.length; i++ ) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((4294967296 * (2097151 & h2)) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
