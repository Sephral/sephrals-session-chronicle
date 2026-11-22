/**
 * Constants and small helpers shared by the scripts of the module. The module runs on Foundry 13 and 14, so it uses
 * game.i18n instead of the v14 global _loc.
 */

/** The id of this module. */
export const MODULE_ID = "sephrals-session-chronicle";

/** The folder of the module's templates. */
export const TEMPLATES = `modules/${MODULE_ID}/templates`;

/** The Foundry versions the module was verified against (see the self test). */
export const TESTED_VERSIONS = {core: "14.370"};

/** Sephral's modules whose public APIs the chronicle reads when they are active. */
export const PARTNERS = {
  combat: "sephrals-combat-log-stats",
  album: "sephrals-campaign-album",
  loot: "sephrals-loot-ledger"
};

/**
 * Read a setting of this module.
 * @param {string} key
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Localize a key, with optional data.
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

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
 * Is a window open or on its way?
 * @param {ApplicationV2|undefined} app
 * @returns {boolean}
 */
export function isShown(app) {
  const states = foundry.applications.api.ApplicationV2.RENDER_STATES;
  return !!app && ((app.state === states.RENDERED) || (app.state === states.RENDERING));
}

/**
 * Is this client the active GM, the one that records and writes?
 * @returns {boolean}
 */
export function isActiveGM() {
  return !!game.user?.isGM && (game.users.activeGM?.id === game.user.id);
}

/**
 * The public API of a partner module, when it is active.
 * @param {string} id
 * @returns {object|null}
 */
export function partnerApi(id) {
  const module = game.modules.get(id);
  return module?.active && module.api ? module.api : null;
}

/**
 * Open Foundry's settings on the tab of this module.
 */
export async function openSettings() {
  const sheet = game.settings.sheet;
  await sheet.render({force: true});
  try {
    sheet.changeTab(MODULE_ID, "categories");
  } catch(err) {
    console.warn(`${MODULE_ID} | The settings have no tab for this module`, err);
  }
  sheet.bringToFront?.();
}

/**
 * Put a gear into the title bar of a window that opens the settings of this module.
 * @param {HTMLElement} frame   The window frame
 */
export function addSettingsGear(frame) {
  const header = frame?.querySelector(".window-header");
  if ( !header || header.querySelector(".ssc-settings") ) return;
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "header-control icon fa-solid fa-gear ssc-settings";
  gear.dataset.tooltip = t("SSC.gear");
  gear.setAttribute("aria-label", t("SSC.gear"));
  gear.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings();
  });
  const anchor = header.querySelector("[data-action=toggleControls]") ?? header.querySelector("[data-action=close]");
  if ( anchor ) anchor.before(gear);
  else header.append(gear);
}

/**
 * Is Foundry 14 (or newer) running?
 * @returns {boolean}
 */
export function isV14() {
  return game.release.generation >= 14;
}
