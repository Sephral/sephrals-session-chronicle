import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {KINDS} from "../scripts/logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));

/** All texts of a nested object. */
function texts(object) {
  return Object.values(object).flatMap(value => ((value && (typeof value === "object")) ? texts(value) : [String(value)]));
}

test("public texts use no dashes or hyphens as punctuation", () => {
  for ( const text of [...texts(en), ...texts(de)] ) {
    // "Debug-Datei" is the same word in every Sephral module
    const plain = text.replace(/\{\w+\}/g, "").replace(/Debug-Datei/g, "");
    assert.ok(!/[–—]/.test(plain), text);
    assert.ok(!/ - /.test(plain), text);
    assert.ok(!/[A-Za-zÄÖÜäöüß]-[A-Za-zÄÖÜäöüß]/.test(plain), text);
  }
});

test("every kind of fact has a label and a line for the window", () => {
  for ( const kind of KINDS ) {
    assert.equal(typeof en.SSC.Kind[kind], "string", kind);
    assert.equal(typeof de.SSC.Kind[kind], "string", kind);
    assert.equal(typeof en.SSC.KindOne[kind], "string", kind);
    assert.equal(typeof de.SSC.KindOne[kind], "string", kind);
  }
  for ( const key of ["scene", "combat", "level", "item", "shownJournal", "shownImage", "crit", "fumble"] ) {
    assert.equal(typeof en.SSC.Fact[key], "string", key);
    assert.equal(typeof de.SSC.Fact[key], "string", key);
  }
});

test("every text with a count has a singular and a plural in both languages", () => {
  for ( const lang of [en, de] ) {
    for ( const group of [lang.SSC.Text, lang.SSC.Combat] ) {
      for ( const key of Object.keys(group).filter(k => k.endsWith("One")) ) {
        assert.equal(typeof group[key.replace(/One$/, "Other")], "string", key);
      }
    }
  }
});

test("no text names another module that is not Sephral's", () => {
  for ( const text of [...texts(en), ...texts(de)] ) {
    assert.ok(!/Dice So Nice|Better Rolltables|Item Piles|Pin Cushion|Archivist|Scry/i.test(text), text);
  }
});

test("no text mentions AI", () => {
  for ( const text of [...texts(en), ...texts(de)] ) assert.ok(!/\bAI\b|\bKI\b|artificial/i.test(text), text);
});
