import assert from "node:assert/strict";
import test from "node:test";

// The sample builders need only a little of Foundry: texts come back as their keys.
globalThis.game = {i18n: {lang: "en", localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data ?? {})}`}, settings: {get: () => ""}};
globalThis.foundry = {applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: base => base}}};

const {__test__, samplePageHtml} = await import("../scripts/sample-windows.mjs");
const {summarize, isEmpty, previouslyCard, missedCard} = await import("../scripts/logic.mjs");
const ctx = {t: game.i18n.format, num: String};

test("the sample night has every kind of fact, once or more", () => {
  const facts = __test__.sampleFacts(1_000_000_000_000);
  const kinds = new Set(facts.map(f => f.k));
  assert.deepEqual([...kinds].sort(), ["combat", "item", "level", "roll", "scene", "shown"]);
  assert.equal(new Set(facts.map(f => f.id)).size, facts.length);
  const summary = summarize(facts);
  assert.ok(!isEmpty(summary));
  assert.ok(summary.highlights.some(h => h.kind === "crit") && summary.highlights.some(h => h.kind === "fumble"));
  assert.ok(summary.shown.some(s => s.what === "journal") && summary.shown.some(s => s.what === "image"));
  assert.ok(summary.fights[0].downed.length > 0);
});

test("the sample session and pages are in memory only", () => {
  const session = __test__.sampleSession(1_000_000_000_000);
  assert.equal(session.number, 4);
  assert.ok(session.started < session.last);
  const pages = __test__.samplePages(1_000_000_000_000, 3);
  assert.deepEqual(pages.map(p => p.flags.session.number), [1, 2, 3]);
  assert.equal(__test__.samplePages(1_000_000_000_000, 0).length, 0);
  assert.ok(__test__.sampleAttendees().some(a => a.late));
});

test("the sample page shows the partner parts only when asked", () => {
  assert.match(samplePageHtml({partner: true}), /ssc-photos/);
  assert.doesNotMatch(samplePageHtml({partner: false}), /ssc-photos/);
  assert.match(samplePageHtml({quiet: true}), /SSC\.Page\.quiet/);
});

test("the sample cards render", () => {
  const summary = summarize(__test__.sampleFacts());
  assert.match(previouslyCard({number: 4, date: "x", summary, note: "n", partner: {}, pageUuid: "u"}, ctx), /data-ssc-open/);
  assert.match(missedCard({summary, firstTime: true}, ctx), /ssc-missed/);
});
