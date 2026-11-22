/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID} from "./config.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: "language", choices: {
    [FOLLOW_FOUNDRY]: "SSC.LANGUAGE.default", de: "SSC.LANGUAGE.de", en: "SSC.LANGUAGE.en"}},
  theme: {type: String, default: "signature", scope: "client", onChange: "redraw", choices: {
    signature: "SSC.SETTINGS.theme.signature", foundry: "SSC.SETTINGS.theme.foundry"}},
  recording: {type: Boolean, default: true},
  recordAlone: {type: Boolean, default: false},
  gapHours: {type: Number, default: 6, range: {min: 1, max: 48, step: 1}},
  autoPage: {type: Boolean, default: true},
  idleMinutes: {type: Number, default: 30, range: {min: 5, max: 120, step: 5}},
  previously: {type: String, default: "everyone", choices: {
    everyone: "SSC.SETTINGS.previously.everyone", gm: "SSC.SETTINGS.previously.gm", off: "SSC.SETTINGS.previously.off"}},
  missed: {type: Boolean, default: true},
  missedMinutes: {type: Number, default: 10, range: {min: 2, max: 60, step: 1}},
  playerAccess: {type: Boolean, default: true, onChange: "access"},
  partnerData: {type: Boolean, default: true},
  highlights: {type: Boolean, default: true},
  shown: {type: Boolean, default: true}
};

/** The functions the menus call, set by registerSettings. */
let menuHandlers = {};

/**
 * Register all settings of the module and its menus.
 * @param {object} handlers   {language, redraw, access, state, openChronicle}
 */
export function registerSettings(handlers) {
  menuHandlers = handlers;
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `SSC.SETTINGS.${key}.name`,
      hint: `SSC.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: true,
      type: def.type,
      choices: def.choices,
      range: def.range,
      default: def.default,
      requiresReload: false,
      onChange: def.onChange ? value => handlers[def.onChange]?.(value) : undefined
    });
  }

  // Data of the module: the session that is open and what is waiting, the id of the Chronicle journal, the version note
  game.settings.register(MODULE_ID, "state", {scope: "world", config: false, type: Object, default: {},
    onChange: value => handlers.state?.(value)});
  game.settings.register(MODULE_ID, "journal", {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});

  // The module's own menu first, then the self test (the debug file comes after, registered by registerDebug)
  game.settings.registerMenu(MODULE_ID, "chronicle", {
    name: "SSC.Menu.title",
    label: "SSC.Menu.open",
    hint: "SSC.Menu.hint",
    icon: "fa-solid fa-book-open",
    type: ChronicleMenu,
    restricted: false
  });
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SSC.SELFTEST.Title",
    label: "SSC.SELFTEST.Run",
    hint: "SSC.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: SelfTestMenu,
    restricted: true
  });
}

/** The menu button which opens the chronicle window. Foundry only accepts application classes as menus. */
class ChronicleMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    menuHandlers.openChronicle?.();
    return this;
  }
}

/** The menu button which runs the self test. */
class SelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/**
 * Switch the module strings when the user picks another module language, then redraw.
 * @param {string} value
 * @param {Function} redraw
 */
export function changeLanguage(value, redraw) {
  applyModuleLanguage(value).then(() => {
    redraw();
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}
