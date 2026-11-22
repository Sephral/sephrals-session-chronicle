import {MODULE_ID, TESTED_VERSIONS, isActiveGM, setting, t} from "./config.mjs";
import {openChronicle, openPage, refreshChronicle} from "./app.mjs";
import {ageSession, applyPlayerAccess, currentState, endSession, flush, journal, onStateSetting, record, repostPreviously,
  scanPresence, sessionPages, setChangeListener, tick, writeNow} from "./chronicle.mjs";
import {registerCollector, rememberLevels, watchShows} from "./collector.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {registerHubModule} from "./hub.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerSettings} from "./settings.mjs";
import {sampleWindows} from "./sample-windows.mjs";
import {registerUsage} from "./usage.mjs";

/** The name of the tool in the scene controls. */
const TOOL = "sscChronicle";

/** How often the active GM looks at who is online and whether a quiet session needs its page, in ms. */
const TICK_MS = 60 * 1000;

Hooks.once("init", () => {
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings({
    language: value => changeLanguage(value, refreshChronicle),
    redraw: () => refreshChronicle(),
    access: () => applyPlayerAccess(),
    state: () => onStateSetting(),
    openChronicle
  });
  // Counted only on the active GM's client, like every Sephral module: pages it writes, cards it posts, what the GM does
  registerUsage(MODULE_ID, {
    features: ["pageWritten", "pageManual", "sessionEnded", "previouslyPosted", "previouslyReposted", "missedSent",
      "noteSaved", "factRemoved", "windowOpened", "pageOpened"],
    settings: ["recording", "gapHours", "previously", "missed", "playerAccess", "autoPage", "partnerData"]
  });
  registerCollector();
  registerDebug();
  setChangeListener(refreshChronicle);

  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderJournalDirectory", onRenderJournalDirectory);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  for ( const kind of ["create", "update", "delete"] ) {
    Hooks.on(`${kind}JournalEntryPage`, page => {
      if ( page.parent?.getFlag(MODULE_ID, "chronicle") ) refreshChronicle();
    });
  }

  game.modules.get(MODULE_ID).api = {
    /** Open the window. */
    open: openChronicle,
    /** Open a session page (its id) in the journal. */
    openPage,
    /** The Chronicle journal, or null before the first page. */
    journal,
    /** The session pages in order. */
    pages: () => sessionPages().map(page => ({id: page.id, uuid: page.uuid, name: page.name, ...(page.flags?.[MODULE_ID] ?? {})})),
    /** The state: the open session, the counter and what waits. A copy. */
    state: () => foundry.utils.deepClone(currentState()),
    /** Record a fact on the active GM's client: {k: "scene"|"combat"|"level"|"item"|"shown"|"roll", ...}. */
    record,
    /** Active GM. Write the page of the open session now, without ending it. */
    writeNow,
    /** Active GM. End the open session and write its page. */
    endSession,
    /** Active GM. Post the card "Previously" for a session page (its id) again. */
    previously: (pageId, options) => repostPreviously(pageId, options),
    /** Active GM. Look at who is online now (attendance, late players, the card "Previously"). */
    scan: scanPresence,
    /** Active GM. The check every minute: attendance and the page of a quiet session. */
    tick,
    /** Active GM. Make the open session look older by some hours (for tests). */
    ageSession,
    /** Active GM. Save the state at once. */
    flush,
    /** Sample windows with made-up data for translators and testers, nothing is saved. */
    samples: () => sampleWindows(),
    /** Check the module (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM). */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(game.settings.get(MODULE_ID, "uiLanguage"));
});

Hooks.once("ready", async () => {
  await languageReady;
  rememberLevels();
  watchShows();
  noticeNewVersions();
  setInterval(() => tick().catch(err => console.warn(`${MODULE_ID} |`, err)), TICK_MS);
  if ( isActiveGM() ) scanPresence().catch(err => console.warn(`${MODULE_ID} |`, err));
  // A page the browser is leaving takes its last facts along
  globalThis.addEventListener?.("pagehide", () => {
    if ( isActiveGM() ) flush();
  });
});

/* -------------------------------------------- */

/**
 * Hook "getSceneControlButtons": the chronicle in the token controls, for everybody.
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  const tokens = controls?.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if ( !tokens ) return;
  const tool = {name: TOOL, title: "SSC.Title", icon: "fa-solid fa-book-open", button: true, visible: true,
    onChange: () => openChronicle()};
  if ( Array.isArray(tokens.tools) ) tokens.tools.push({...tool, onClick: tool.onChange});
  else {
    tool.order = Object.keys(tokens.tools ?? {}).length;
    tokens.tools[tool.name] = tool;
  }
}

/**
 * Hook "renderJournalDirectory": a button above the journal list.
 * @param {Application} app
 * @param {HTMLElement} html
 */
function onRenderJournalDirectory(app, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const actions = element?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".ssc-open") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ssc-open";
  button.innerHTML = `<i class="fa-solid fa-book-open" inert></i> <span>${t("SSC.Title")}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    openChronicle();
  });
  actions.append(button);
}

/**
 * Hook "renderChatMessageHTML": the button of the cards opens the session page.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function onRenderChatMessage(message, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !element ) return;
  for ( const card of element.querySelectorAll(".ssc-card") ) card.dataset.sscTheme = setting("theme");
  for ( const button of element.querySelectorAll("button[data-ssc-open]") ) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const page = await fromUuid(button.dataset.sscOpen);
      if ( page ) openPage(page.id);
      else ui.notifications.warn(game.i18n.localize("SSC.App.noAccess"));
    });
  }
}

