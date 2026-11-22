import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {EVENT_LIMIT, LATE_MINUTES, addEvent, attendeesOf, cardLines, closePresence, combatLines, combatSnapshot,
  counted, fingerprint, isEmpty, isIdle, isLootType, joinNames, levelOf, lootOf, missedCard, missedFor, naturalD20,
  needsNewSession, noteBlock, noteOf, photosOf, plainText, previouslyCard, removeEvent, renderPage, replaceNote,
  sectionLines, startSession, summarize, updatePresence, visibleItemName, worthWriting} from "../scripts/logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));

/** A localize function for the tests, like game.i18n.format. */
const make = lang => (key, data) => {
  const text = key.split(".").reduce((o, k) => o?.[k], lang);
  assert.equal(typeof text, "string", key);
  return text.replace(/\{(\w+)\}/g, (all, name) => String(data?.[name] ?? ""));
};
const ctx = {t: make(en), num: n => String(n)};
const ctxDe = {t: make(de), num: n => String(n)};

const H = 3600 * 1000;
const M = 60 * 1000;
const T0 = Date.UTC(2026, 10, 21, 19, 0);

/** A session with some of everything. */
function sample() {
  const s = startSession(4, T0);
  addEvent(s, {k: "scene", name: "Harbor", sceneId: "h"}, T0 + M);
  addEvent(s, {k: "scene", name: "Old Tower", sceneId: "t"}, T0 + 40 * M);
  addEvent(s, {k: "combat", combatId: "c1", scene: "Old Tower", rounds: 4, defeated: ["Skeleton", "Skeleton", "Wraith"],
    downed: ["Aria"]}, T0 + 70 * M);
  addEvent(s, {k: "level", actor: "Bram", actorId: "b", from: 3, to: 4}, T0 + 80 * M);
  addEvent(s, {k: "item", actor: "Aria", actorId: "a", name: "Ring", qty: 1}, T0 + 85 * M);
  addEvent(s, {k: "item", actor: "Aria", actorId: "a", name: "Potion", qty: 2}, T0 + 86 * M);
  addEvent(s, {k: "shown", what: "journal", title: "The Letter"}, T0 + 90 * M);
  addEvent(s, {k: "shown", what: "image", title: "Map of the coast"}, T0 + 95 * M);
  addEvent(s, {k: "roll", kind: "crit", who: "Cole", messageId: "m1", flavor: "Dagger Attack"}, T0 + 100 * M);
  addEvent(s, {k: "roll", kind: "fumble", who: "Bram", messageId: "m2", flavor: ""}, T0 + 101 * M);
  return s;
}

test("a gap of several hours starts a new session, a short pause does not", () => {
  const s = startSession(1, T0);
  assert.equal(needsNewSession(null, T0, 6), true);
  assert.equal(needsNewSession(s, T0 + 5 * H, 6), false);
  assert.equal(needsNewSession(s, T0 + 6 * H + 1, 6), true);
  assert.equal(needsNewSession(s, T0 + 30 * H, 48), false);
  s.last = T0 + 10 * H;
  assert.equal(needsNewSession(s, T0 + 15 * H, 6), false, "the gap counts from the last activity");
});

test("a session is quiet after the idle minutes", () => {
  assert.equal(isIdle({last: T0}, T0 + 29 * M, 30), false);
  assert.equal(isIdle({last: T0}, T0 + 30 * M, 30), true);
});

test("a session is worth a page with a fact or a player", () => {
  const s = startSession(1, T0);
  assert.equal(worthWriting(s), false);
  assert.equal(worthWriting(null), false);
  addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0);
  assert.equal(worthWriting(s), true);
  const t = startSession(2, T0);
  updatePresence(t, [{id: "p", name: "Pia", active: true}], T0);
  assert.equal(worthWriting(t), true);
});

test("facts are merged: scenes in a row, items, levels, rolls, combats and shown things", () => {
  const s = startSession(1, T0);
  assert.ok(addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0));
  assert.equal(addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0 + 1), null);
  assert.ok(addEvent(s, {k: "scene", name: "B", sceneId: "b"}, T0 + 2));
  assert.ok(addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0 + 3), "going back is a new visit");
  assert.ok(addEvent(s, {k: "item", actor: "X", actorId: "x", name: "Gem", qty: 1}, T0));
  assert.equal(addEvent(s, {k: "item", actor: "X", actorId: "x", name: "Gem", qty: 3}, T0), null);
  assert.equal(s.events.find(e => e.k === "item").qty, 4);
  assert.ok(addEvent(s, {k: "level", actor: "X", actorId: "x", from: 1, to: 2}, T0));
  assert.equal(addEvent(s, {k: "level", actor: "X", actorId: "x", from: 1, to: 2}, T0), null);
  assert.ok(addEvent(s, {k: "roll", kind: "crit", messageId: "m", who: "X"}, T0));
  assert.equal(addEvent(s, {k: "roll", kind: "crit", messageId: "m", who: "X"}, T0), null);
  assert.ok(addEvent(s, {k: "combat", combatId: "c", rounds: 1, defeated: [], downed: []}, T0));
  assert.equal(addEvent(s, {k: "combat", combatId: "c", rounds: 2, defeated: [], downed: []}, T0), null);
  assert.ok(addEvent(s, {k: "shown", what: "image", title: "Map"}, T0));
  assert.equal(addEvent(s, {k: "shown", what: "image", title: "Map"}, T0 + 10000), null);
  assert.ok(addEvent(s, {k: "shown", what: "image", title: "Map"}, T0 + 60000), "much later is another showing");
  assert.equal(addEvent(s, {k: "weather", text: "rain"}, T0), null, "unknown kinds are left out");
});

test("facts get ids and move the last activity", () => {
  const s = startSession(1, T0);
  const fact = addEvent(s, {k: "scene", name: "A", sceneId: "a", t: T0 + 5 * M}, T0 + 6 * M);
  assert.equal(fact.id, "e1");
  assert.equal(fact.t, T0 + 5 * M);
  assert.equal(s.last, T0 + 5 * M);
});

test("too many facts drop the oldest rolls first", () => {
  const s = startSession(1, T0);
  addEvent(s, {k: "scene", name: "Keep", sceneId: "k"}, T0);
  for ( let i = 0; i < 20; i++ ) addEvent(s, {k: "roll", kind: "crit", messageId: `m${i}`, who: "X"}, T0 + i, {limit: 10});
  assert.equal(s.events.length, 10);
  assert.equal(s.events[0].k, "scene");
  assert.equal(EVENT_LIMIT, 600);
});

test("a fact can be removed", () => {
  const s = sample();
  const id = s.events[0].id;
  assert.equal(removeEvent(s, id), true);
  assert.equal(removeEvent(s, id), false);
  assert.ok(!s.events.some(e => e.id === id));
});

test("the natural result comes from the first d20 and ignores dropped dice", () => {
  assert.deepEqual(naturalD20([{faces: 20, results: [{result: 20, active: true}]}]), {natural: 20, max: true, min: false});
  assert.equal(naturalD20([{faces: 20, results: [{result: 1, active: true}]}]).min, true);
  assert.equal(naturalD20([{faces: 20, results: [{result: 20, active: false, discarded: true}, {result: 7, active: true}]}]).max, false);
  assert.equal(naturalD20([{faces: 6, results: [{result: 6, active: true}]}]).natural, null);
  assert.equal(naturalD20(undefined).natural, null);
});

test("plain text strips HTML and cuts long flavor", () => {
  assert.equal(plainText("<b>Longsword</b> &nbsp;Attack"), "Longsword Attack");
  assert.equal(plainText("x".repeat(100), 10).length, 10);
  assert.equal(plainText(undefined), "");
});

test("levels are found in the systems the module knows", () => {
  assert.equal(levelOf({details: {level: 5}}), 5);
  assert.equal(levelOf({details: {level: {value: 7}}}), 7);
  assert.equal(levelOf({advancement: {level: 3}}), 3);
  assert.equal(levelOf({}, 2), 2);
  assert.equal(levelOf({details: {level: 0}}), null);
  assert.equal(levelOf(null), null);
});

test("class features and spells are no loot", () => {
  assert.equal(isLootType("weapon"), true);
  assert.equal(isLootType("consumable"), true);
  assert.equal(isLootType("class"), false);
  assert.equal(isLootType("Spell"), false);
  assert.equal(isLootType("feat"), false);
});

test("attendance follows players coming and going", () => {
  const s = startSession(1, T0);
  const a = updatePresence(s, [{id: "p1", name: "Pia", character: "Aria", active: true}, {id: "p2", name: "Quinn", active: false}], T0);
  assert.deepEqual(a, {joined: ["p1"], left: []});
  const b = updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: true}], T0 + 30 * M);
  assert.deepEqual(b, {joined: ["p2"], left: []});
  const c = updatePresence(s, [{id: "p1", name: "Pia", active: false}, {id: "p2", name: "Quinn", active: true}], T0 + 60 * M);
  assert.deepEqual(c, {joined: [], left: ["p1"]});
  const d = updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: true}], T0 + 70 * M);
  assert.deepEqual(d, {joined: ["p1"], left: []});
  assert.equal(s.attendance.p1.spans.length, 2);
  assert.equal(s.attendance.p1.character, "Aria");
  closePresence(s, T0 + 90 * M);
  assert.ok(Object.values(s.attendance).every(e => e.spans.at(-1)[1] !== null));
});

test("a player who arrives well after the start is late, but not when nothing had happened", () => {
  const s = startSession(1, T0);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}], T0);
  addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0 + 5 * M);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: true}], T0 + (LATE_MINUTES + 5) * M);
  const people = attendeesOf(s);
  assert.deepEqual(people.map(p => [p.name, p.late]), [["Pia", false], ["Quinn", true]]);
  const quiet = startSession(2, T0);
  updatePresence(quiet, [{id: "p1", name: "Pia", active: true}], T0 + 2 * H);
  assert.equal(attendeesOf(quiet)[0].late, false);
});

test("a late player misses the facts since the start, a returning player those since leaving", () => {
  const s = startSession(1, T0);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: false}], T0);
  addEvent(s, {k: "scene", name: "A", sceneId: "a"}, T0 + 5 * M);
  addEvent(s, {k: "combat", combatId: "c", scene: "A", rounds: 2, defeated: ["Rat"], downed: []}, T0 + 25 * M);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: true}], T0 + 40 * M);
  const late = missedFor(s, "p2", T0 + 40 * M, {minMinutes: 10});
  assert.equal(late.firstTime, true);
  assert.equal(late.events.length, 2);
  assert.equal(missedFor(s, "p1", T0 + 40 * M, {minMinutes: 10}), null, "somebody who was there the whole time misses nothing");
  // Quinn leaves at +50 and comes back at +90
  updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: false}], T0 + 50 * M);
  addEvent(s, {k: "level", actor: "Aria", actorId: "a", to: 2}, T0 + 60 * M);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}, {id: "p2", name: "Quinn", active: true}], T0 + 90 * M);
  const back = missedFor(s, "p2", T0 + 90 * M, {minMinutes: 10});
  assert.equal(back.firstTime, false);
  assert.deepEqual(back.events.map(e => e.k), ["level"]);
  assert.equal(missedFor(s, "p2", T0 + 90 * M, {minMinutes: 120}), null, "a short absence is no absence");
  assert.equal(missedFor(s, "nobody", T0, {}), null);
});

test("nothing missed means no card", () => {
  const s = startSession(1, T0);
  updatePresence(s, [{id: "p1", name: "Pia", active: false}], T0);
  updatePresence(s, [{id: "p1", name: "Pia", active: true}], T0 + 30 * M);
  assert.equal(missedFor(s, "p1", T0 + 30 * M, {minMinutes: 10}), null);
});

test("the summary groups facts the way a page tells them", () => {
  const summary = summarize(sample().events);
  assert.deepEqual(summary.scenes.map(s => s.name), ["Harbor", "Old Tower"]);
  assert.deepEqual(summary.fights[0].defeated, [{name: "Skeleton", count: 2}, {name: "Wraith", count: 1}]);
  assert.deepEqual(summary.fights[0].downed, ["Aria"]);
  assert.deepEqual(summary.levelUps, [{actor: "Bram", from: 3, to: 4}]);
  assert.deepEqual(summary.items, [{actor: "Aria", items: [{name: "Ring", qty: 1}, {name: "Potion", qty: 2}]}]);
  assert.equal(summary.shown.length, 2);
  assert.deepEqual(summary.highlights.map(h => h.kind), ["crit", "fumble"]);
  assert.equal(isEmpty(summary), false);
  assert.equal(isEmpty(summarize([])), true);
  assert.equal(isEmpty(null), true);
});

test("a scene visited twice counts its visits", () => {
  const s = startSession(1, T0);
  for ( const [i, id] of ["a", "b", "a"].entries() ) addEvent(s, {k: "scene", name: id.toUpperCase(), sceneId: id}, T0 + i);
  assert.deepEqual(summarize(s.events).scenes, [{name: "A", visits: 2}, {name: "B", visits: 1}]);
});

test("names are joined like a speaker would", () => {
  const t = make(en);
  assert.equal(joinNames([], t), "");
  assert.equal(joinNames(["A"], t), "A");
  assert.equal(joinNames(["A", "B"], t), "A and B");
  assert.equal(joinNames(["A", "B", "C"], t), "A, B and C");
  assert.equal(joinNames(["A", "B", "C"], make(de)), "A, B und C");
  assert.equal(counted(t, "SSC.Text.rounds", 1), "1 round");
  assert.equal(counted(t, "SSC.Text.rounds", 4), "4 rounds");
});

test("the lines tell fights, level ups, loot, handouts and big rolls", () => {
  const lines = sectionLines(summarize(sample().events), ctx);
  assert.deepEqual(lines.fights.page, ["Old Tower: 4 rounds, defeated Skeleton ×2 and Wraith. Heroes down: Aria."]);
  assert.deepEqual(lines.levels.page, ["Bram reached level 4."]);
  assert.deepEqual(lines.items.page, ["Aria gained Ring and Potion ×2."]);
  assert.deepEqual(lines.shown.page, ["Handout shown: The Letter", "Picture shown: Map of the coast"]);
  assert.deepEqual(lines.shown.card, ["Shown at the table: 1 handout and 1 picture."]);
  assert.deepEqual(lines.highlights.page, ["Cole rolled a natural 20 (Dagger Attack).", "Bram rolled a natural 1."]);
  assert.deepEqual(lines.scenes.card, ["The party visited Harbor and Old Tower."]);
  const german = sectionLines(summarize(sample().events), ctxDe);
  assert.equal(german.levels.page[0], "Bram erreichte Stufe 4.");
});

test("many scenes shorten on the card but not on the page", () => {
  const s = startSession(1, T0);
  for ( let i = 0; i < 8; i++ ) addEvent(s, {k: "scene", name: `Place ${i}`, sceneId: `p${i}`}, T0 + i);
  const lines = sectionLines(summarize(s.events), ctx);
  assert.equal(lines.scenes.page.length, 8);
  assert.match(lines.scenes.card[0], /More places: 3./);
});

test("a fight without a defeated foe says so", () => {
  const s = startSession(1, T0);
  addEvent(s, {k: "combat", combatId: "c", scene: "", rounds: 1, defeated: [], downed: []}, T0);
  assert.deepEqual(sectionLines(summarize(s.events), ctx).fights.page, ["somewhere: 1 round, nobody was defeated."]);
});

test("the combat totals read well and need fights", () => {
  assert.equal(combatSnapshot(null), null);
  assert.equal(combatSnapshot({fights: 0}), null);
  const snap = combatSnapshot({fights: 2, rounds: 7, damage: 120, healing: 30, enemiesDefeated: 5, partyDowned: 1, criticalHits: 2,
    awards: [{key: "mvp", names: ["Aria", "Bram"], value: 90}]});
  assert.deepEqual(combatLines(snap, ctx), ["In all, 2 fights with 7 rounds.", "The heroes dealt 120 damage and healed 30.",
    "5 foes defeated.", "1 hero went down.", "2 critical hits.", "Hero of the night: Aria and Bram."]);
  assert.deepEqual(combatLines(null, ctx), []);
  assert.equal(combatLines(combatSnapshot({fights: 1, rounds: 1, damage: 5}), ctx)[1], "The heroes dealt 5 damage.");
});

test("loot and photos of the other modules are cut to the time of the session", () => {
  const entries = [
    {kind: "add", time: T0 + M, from: {kind: "outside"}, item: {name: "Gem", quantity: 2}},
    {kind: "add", time: T0 + 2 * M, from: {kind: "outside"}, item: {name: "Gem", quantity: 1}},
    {kind: "move", time: T0 + 3 * M, item: {name: "Sword", quantity: 1}},
    {kind: "add", time: T0 - H, from: {kind: "outside"}, item: {name: "Old", quantity: 1}},
    {kind: "add", time: T0 + 4 * M, from: {kind: "stash"}, item: {name: "Moved", quantity: 1}},
    {kind: "award", time: T0 + 5 * M, from: {kind: "outside"}, item: {name: "Cup", quantity: 1}},
    {kind: "split", time: T0 + 5 * M, coins: 40}
  ];
  assert.deepEqual(lootOf(entries, T0, T0 + H), [{name: "Gem", qty: 3}, {name: "Cup", qty: 1}]);
  const photos = [{src: "a.webp", time: T0 + 2, caption: "x"}, {src: "b.webp", time: T0 - 5}, {time: T0}, {src: "c.webp", time: T0 + 1}];
  assert.deepEqual(photosOf(photos, T0, T0 + H), [{src: "c.webp", caption: ""}, {src: "a.webp", caption: "x"}]);
  assert.equal(photosOf(photos, T0, T0 + H, 1).length, 1);
});

test("the page has sections, the GM's note first and everything escaped", () => {
  const s = sample();
  updatePresence(s, [{id: "p1", name: "Pia <b>", character: "Aria", active: true}], T0);
  const html = renderPage({summary: summarize(s.events), note: "Remember the <letter>.\n\nSecond line.", attendees: attendeesOf(s),
    partner: {combat: combatSnapshot({fights: 1, rounds: 4, damage: 60}), loot: [{name: "Gem", qty: 2}],
      photos: [{src: "p.webp", caption: "Tower"}]}, span: "Saturday, 19:00 to 21:00"}, ctx);
  assert.match(html, /^<div class="ssc-page"><blockquote class="ssc-note"><h3>From the GM<\/h3><p>Remember the &lt;letter&gt;\.<\/p><p>Second line\.<\/p>/);
  const headings = ["At the table", "Fights", "Big moments", "Level ups", "Loot and items", "Shown at the table", "Where the party went", "Photos"];
  for ( const heading of headings ) assert.ok(html.includes(`</i> ${heading}</h2>`), heading);
  assert.ok(html.includes("Pia &lt;b&gt; as Aria"));
  assert.ok(html.includes("Found as loot: Gem ×2."));
  assert.ok(html.includes("In all, 1 fight with 4 rounds."));
  assert.ok(html.includes("<figcaption>Tower</figcaption>"));
  assert.ok(!html.includes("<letter>"));
  const order = headings.map(h => html.indexOf(`</i> ${h}</h2>`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("an empty session says it was quiet", () => {
  const html = renderPage({summary: summarize([]), note: "", attendees: [], span: "x"}, ctx);
  assert.ok(html.includes("Nothing was recorded for this session."));
  assert.ok(!html.includes("ssc-note"));
});

test("the note can be changed in a page the GM edited by hand", () => {
  const original = renderPage({summary: summarize(sample().events), note: "First", attendees: [], span: "x"}, ctx);
  assert.equal(noteOf(original), "First");
  const edited = original.replace("Fights", "Battles");
  const changed = replaceNote(edited, noteBlock("Second\n\nThird", "From the GM"));
  assert.ok(changed.includes("Battles"));
  assert.equal(noteOf(changed), "Second\n\nThird");
  assert.equal(noteOf(replaceNote(changed, noteBlock("", "x"))), "");
  assert.ok(replaceNote("<p>plain</p>", noteBlock("Hi", "H")).startsWith("<blockquote class=\"ssc-note\">"));
  assert.ok(replaceNote("<div class=\"ssc-page\"><p>x</p></div>", noteBlock("Hi", "H")).startsWith("<div class=\"ssc-page\"><blockquote"));
  assert.equal(noteOf("<p>none</p>"), "");
  assert.equal(noteOf(replaceNote("", noteBlock("A & B <c>", "H"))), "A & B <c>");
});

test("a page edited by hand is noticed by its fingerprint", () => {
  const a = renderPage({summary: summarize(sample().events), note: "", attendees: [], span: "x"}, ctx);
  assert.equal(fingerprint(a), fingerprint(a));
  assert.notEqual(fingerprint(a), fingerprint(a.replace("Fights", "Battles")));
  assert.equal(fingerprint("x").length, 14);
});

test("the Previously card shows the GM's line, the most important facts and a way to the page", () => {
  const summary = summarize(sample().events);
  const html = previouslyCard({number: 4, date: "21 November 2026", summary, note: "We left the tower <burning>.",
    partner: {}, pageUuid: "JournalEntry.a.JournalEntryPage.b"}, ctx);
  assert.ok(html.includes("<h3>Previously</h3>"));
  assert.ok(html.includes("Session 4, 21 November 2026"));
  assert.ok(html.includes("We left the tower &lt;burning&gt;."));
  assert.ok(html.includes("Old Tower: 4 rounds"));
  assert.ok(html.includes("data-ssc-open=\"JournalEntry.a.JournalEntryPage.b\""));
  assert.ok(!html.includes("<burning>"));
  const lines = cardLines(summary, ctx);
  assert.ok(lines.length <= 7);
  assert.ok(lines[0].startsWith("Old Tower"), "fights come first");
  assert.ok(previouslyCard({number: 1, date: "d", summary: summarize([]), note: "", pageUuid: "u"}, ctx).includes("A quiet night"));
  assert.ok(previouslyCard({number: 1, date: "d", summary, note: "", pageUuid: "u"}, ctxDe).includes("Was bisher geschah"));
});

test("the card limits its lines", () => {
  const s = startSession(1, T0);
  for ( let i = 0; i < 12; i++ ) addEvent(s, {k: "combat", combatId: `c${i}`, scene: `S${i}`, rounds: 1, defeated: ["Rat"], downed: []}, T0 + i);
  assert.equal(cardLines(summarize(s.events), ctx, 5).length, 5);
});

test("What you missed names the facts and, for a first arrival, the last session", () => {
  const summary = summarize(sample().events);
  const html = missedCard({summary, firstTime: true, last: {number: 3, date: "14 November 2026",
    summary: summarize([{k: "level", t: 1, actor: "Cole", to: 3}])}}, ctx);
  assert.ok(html.includes("What you missed"));
  assert.ok(html.includes("Since the session began"));
  assert.ok(html.includes("Last time, session 3, 14 November 2026"));
  assert.ok(html.includes("Cole reached level 3."));
  assert.ok(html.includes("Only you can see this."));
  const away = missedCard({summary, firstTime: false}, ctx);
  assert.ok(away.includes("While you were away"));
  assert.ok(!away.includes("Last time"));
});

test("the German texts build the same cards and pages", () => {
  const html = renderPage({summary: summarize(sample().events), note: "", attendees: [], span: "x"}, ctxDe);
  assert.ok(html.includes("Kämpfe"));
  assert.ok(html.includes("Bram erreichte Stufe 4."));
  assert.ok(html.includes("Handout gezeigt: The Letter"));
});

test("unidentified items show their cover name or nothing", () => {
  assert.equal(visibleItemName({name: "Ring of Doom", system: {identified: false, unidentified: {name: "Plain ring"}}}), "Plain ring");
  assert.equal(visibleItemName({name: "Ring of Doom", system: {identified: false}}), "");
  assert.equal(visibleItemName({name: "Rope", system: {identified: true}}), "Rope");
  assert.equal(visibleItemName({name: "Rope"}), "Rope");
});

test("the Previously card has no open button without a page link", () => {
  const ctx = {t: key => key, num: n => String(n)};
  const base = {number: 1, date: "d", summary: summarize([]), note: ""};
  assert.ok(!previouslyCard({...base, pageUuid: ""}, ctx).includes("data-ssc-open"));
  assert.ok(previouslyCard({...base, pageUuid: "JournalEntry.a.JournalEntryPage.b"}, ctx).includes("data-ssc-open"));
});
