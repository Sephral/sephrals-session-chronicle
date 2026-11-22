import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");

test("every counted feature is registered, and every registered feature is counted", async () => {
  const skip = ["usage.mjs", "hub.mjs", "debug-file.mjs"];
  const files = (await readdir(path.join(root, "scripts"))).filter(f => f.endsWith(".mjs") && !skip.includes(f));
  let source = "";
  for ( const file of files ) source += await read(`scripts/${file}`);
  const registered = /features: \[([^\]]*)\]/.exec(source)[1].match(/"[^"]+"/g).map(s => s.slice(1, -1));
  const counted = [...source.matchAll(/countFeature\(MODULE_ID, "(\w+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(counted)].sort(), [...registered].sort());
});

test("the entry file follows the Sephral standards", async () => {
  const entry = await read("scripts/ssc.mjs");
  const init = entry.slice(entry.indexOf("Hooks.once(\"init\""));
  assert.match(init.split("\n")[1], /registerHubModule/);
  assert.match(entry, /runSelfTest/);
  assert.match(entry, /saveDebugFile/);
});

test("the manifest and package agree", async () => {
  const module = JSON.parse(await read("module.json"));
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(module.version, pkg.version);
  assert.equal(module.id, pkg.name);
  assert.match(module.title, /^Sephral’s /);
});
