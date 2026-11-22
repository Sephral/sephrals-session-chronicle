/**
 * The collector: listens to Foundry's own hooks on the active GM's client and hands every fact to the chronicle.
 * Scenes, fights, level ups, loot, shown pictures and handouts, and the big rolls. No other module is needed.
 */

import {MODULE_ID, isActiveGM, setting} from "./config.mjs";
import {isLootType, levelOf, naturalD20, plainText, visibleItemName} from "./logic.mjs";
import {record, scanPresence} from "./chronicle.mjs";
import {trace} from "./trace.mjs";

/** Actor types that are no player characters, in any of the game systems. */
const NOT_CHARACTERS = new Set(["npc", "vehicle", "loot", "group", "party", "adversary", "encounter", "hazard",
  "familiar", "minion", "base"]);

/** The levels the collector knows, by actor id. */
const levels = new Map();

/**
 * Run a handler on the active GM's client only, and never let a failure reach Foundry.
 * @param {string} name
 * @param {Function} handler
 * @returns {Function}
 */
function guarded(name, handler) {
  return (...args) => {
    if ( !isActiveGM() || !setting("recording") ) return;
    try {
      const result = handler(...args);
      if ( result?.catch ) result.catch(err => trace.add("collect-failed", {name, message: err?.message}));
    } catch(err) {
      trace.add("collect-failed", {name, message: err?.message});
      console.warn(`${MODULE_ID} | ${name} failed`, err);
    }
  };
}

/**
 * Is an actor one of the players' characters?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
function isPlayerCharacter(actor) {
  return !!actor && actor.hasPlayerOwner && !NOT_CHARACTERS.has(actor.type);
}

/**
 * The name of a scene as players know it.
 * @param {Scene} scene
 * @returns {string}
 */
function sceneName(scene) {
  return scene?.navName || scene?.name || "";
}

/**
 * Register all hooks. Call in "init".
 */
export function registerCollector() {
  Hooks.on("updateScene", guarded("scene", (scene, changes) => {
    if ( changes.active === true ) return record({k: "scene", name: sceneName(scene), sceneId: scene.id});
  }));
  Hooks.on("canvasReady", guarded("scene-view", canvas => {
    const scene = canvas?.scene;
    if ( scene?.active ) return record({k: "scene", name: sceneName(scene), sceneId: scene.id});
  }));
  Hooks.on("deleteCombat", guarded("combat", onCombatEnd));
  Hooks.on("createChatMessage", guarded("roll", onChatMessage));
  Hooks.on("createItem", guarded("item", onItem));
  Hooks.on("updateActor", guarded("level", (actor, changes) => {
    if ( foundry.utils.hasProperty(changes ?? {}, "system") ) checkLevel(actor);
  }));
  for ( const hook of ["updateItem", "createItem", "deleteItem"] ) {
    Hooks.on(hook, guarded("level", doc => checkLevel(doc?.parent)));
  }
  Hooks.on("createActor", actor => rememberLevel(actor));
  Hooks.on("userConnected", () => scanPresence().catch(err => trace.add("scan-failed", {message: err?.message})));
}

/**
 * Remember the levels of the characters (call at "ready").
 */
export function rememberLevels() {
  for ( const actor of game.actors ) rememberLevel(actor);
}

/**
 * @param {Actor} actor
 */
function rememberLevel(actor) {
  if ( !isPlayerCharacter(actor) ) return;
  const level = levelOf(actor.system, actor.level);
  if ( level !== null ) levels.set(actor.id, level);
}

/**
 * A fight ended (the combat was deleted): rounds, defeated foes and heroes who went down. Hidden combatants stay out,
 * the players never saw them.
 * @param {Combat} combat
 */
function onCombatEnd(combat) {
  if ( !combat.started && !(combat.round > 0) ) return;
  const defeated = [];
  const downed = [];
  for ( const combatant of combat.combatants ) {
    if ( combatant.hidden || !combatant.isDefeated ) continue;
    (combatant.hasPlayerOwner ? downed : defeated).push(combatant.name);
  }
  return record({k: "combat", combatId: combat.id, scene: sceneName(combat.scene), rounds: combat.round, defeated, downed});
}

/**
 * A chat message: a natural 20 or a natural 1 on the first d20 of a public roll of the players.
 * @param {ChatMessage} message
 */
function onChatMessage(message) {
  if ( !setting("highlights") || !message.rolls?.length ) return;
  if ( message.blind || message.whisper?.length ) return;
  const actor = message.speakerActor ?? game.actors.get(message.speaker?.actor);
  const author = message.author;
  if ( !(author && !author.isGM) && !isPlayerCharacter(actor) ) return;
  for ( const roll of message.rolls ) {
    const {max, min} = naturalD20(roll.dice);
    if ( !max && !min ) continue;
    return record({k: "roll", kind: max ? "crit" : "fumble", messageId: message.id,
      who: actor?.name ?? message.speaker?.alias ?? author?.name ?? "", flavor: plainText(message.flavor, 50)});
  }
}

/**
 * An item came to a player's character.
 * @param {Item} item
 */
function onItem(item) {
  const actor = item.parent;
  if ( !(actor instanceof Actor) || !isPlayerCharacter(actor) || !isLootType(item.type) ) return;
  const name = visibleItemName(item);
  if ( !name ) return;
  const quantity = Number(item.system?.quantity);
  return record({k: "item", actor: actor.name, actorId: actor.id, name,
    qty: Number.isFinite(quantity) && (quantity > 0) ? quantity : 1});
}

/**
 * Has a character reached a new level? Foundry derives the level from other data, so the check waits a moment until
 * the actor has prepared it.
 * @param {Actor|null} actor
 */
function checkLevel(actor) {
  if ( !isPlayerCharacter(actor) ) return;
  setTimeout(() => {
    try {
      if ( !isActiveGM() ) return;
      const level = levelOf(actor.system, actor.level);
      const before = levels.get(actor.id);
      if ( level === null ) return;
      levels.set(actor.id, level);
      if ( (before !== undefined) && (level > before) ) {
        record({k: "level", actor: actor.name, actorId: actor.id, from: before, to: level});
      }
    } catch(err) {
      trace.add("collect-failed", {name: "level", message: err?.message});
    }
  }, 150);
}

/* -------------------------------------------- */
/*  What the GM shows                           */
/* -------------------------------------------- */

/**
 * Notice what a GM shows to the players. Foundry has no hook for it: the clients talk over the core events
 * "shareImage" and "showEntry". The active GM sees what another GM shows as an event, and what it shows itself in its
 * own emit.
 */
export function watchShows() {
  const socket = game.socket;
  if ( !game.user.isGM || !socket ) return;
  const emit = socket.emit;
  socket.emit = function(event, ...args) {
    if ( (event === "shareImage") || (event === "showEntry") ) {
      try {
        onShown(event, args);
      } catch(err) {
        trace.add("collect-failed", {name: event, message: err?.message});
      }
    }
    return emit.call(this, event, ...args);
  };
  socket.on("shareImage", data => onShown("shareImage", [data]));
  socket.on("showEntry", (uuid, options) => onShown("showEntry", [uuid, options]));
}

/**
 * A GM showed a picture or a journal.
 * @param {string} event
 * @param {Array} args
 */
function onShown(event, args) {
  if ( !isActiveGM() || !setting("recording") || !setting("shown") ) return;
  if ( event === "shareImage" ) {
    const data = args[0];
    if ( !data?.image ) return;
    return record({k: "shown", what: "image", title: String(data.title || titleOfFile(data.image)).slice(0, 80)});
  }
  const uuid = args[0];
  const doc = (typeof uuid === "string") ? fromUuidSync(uuid) : null;
  if ( !doc || doc.getFlag?.(MODULE_ID, "chronicle") || doc.parent?.getFlag?.(MODULE_ID, "chronicle") ) return;
  let title = doc.name;
  if ( doc.documentName === "JournalEntryPage" && doc.parent ) {
    title = (doc.parent.pages.size > 1) ? `${doc.parent.name}, ${doc.name}` : doc.parent.name;
  }
  return record({k: "shown", what: "journal", title: String(title).slice(0, 80)});
}

/**
 * A readable title out of a file path: "maps/old_tower-night.webp" becomes "old tower night".
 * @param {string} path
 * @returns {string}
 */
function titleOfFile(path) {
  const name = decodeURIComponent(String(path).split("?")[0].split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  return name.replace(/[_-]+/g, " ").trim();
}
