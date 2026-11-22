/**
 * The chronicle window. The GM sees the session that is running (who is there, what has been noted, the free line for
 * the page) and the buttons to write the page or end the session. Everybody sees the past sessions and opens their pages.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, isActiveGM, isShown, setting, t} from "./config.mjs";
import {readerLanguage} from "./language.mjs";
import {attendeesOf} from "./logic.mjs";
import {currentState, endSession, factText, formatDate, journal, noteOfPage, removeFact, repostPreviously, sessionPages,
  setNote, writeNow} from "./chronicle.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The id of the window. */
export const APP_ID = "ssc-chronicle";

/** The icons of the kinds of facts. */
const KIND_ICONS = {scene: "fa-map", combat: "fa-swords", level: "fa-arrow-up-right-dots", item: "fa-gem",
  shown: "fa-image", roll: "fa-dice-d20"};

/**
 * "19:02" in the language of the user.
 * @param {number} ms
 * @returns {string}
 */
function clock(ms) {
  try {
    return new Date(ms).toLocaleTimeString(readerLanguage(), {hour: "2-digit", minute: "2-digit"});
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

export class ChronicleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ["ssc-app"],
    tag: "section",
    window: {title: "SSC.App.title", icon: "fa-solid fa-book-open", resizable: true},
    position: {width: 520, height: "auto"},
    actions: {
      writeNow: ChronicleApp.#onWrite,
      endSession: ChronicleApp.#onEnd,
      openJournal: ChronicleApp.#onOpenJournal,
      openPage: ChronicleApp.#onOpenPage,
      previously: ChronicleApp.#onPreviously,
      removeFact: ChronicleApp.#onRemoveFact
    }
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/chronicle.hbs`, scrollable: [".ssc-body"]}};

  /** @override */
  get title() {
    return t("SSC.App.title");
  }

  /** @override */
  async _prepareContext() {
    const state = currentState();
    const open = state.current;
    const pages = sessionPages();
    const active = isActiveGM();
    let session = null;
    if ( open ) {
      const counts = {};
      for ( const event of open.events ) counts[event.k] = (counts[event.k] ?? 0) + 1;
      const players = attendeesOf(open).map(a => a.name);
      session = {
        title: t("SSC.App.sessionTitle", {number: open.number}),
        started: t("SSC.App.since", {time: clock(open.started), date: formatDate(open.started)}),
        players,
        playersText: players.join(", "),
        counts: Object.entries(counts).map(([kind, count]) => ({count, icon: KIND_ICONS[kind], label: t(count === 1 ? `SSC.KindOne.${kind}` : `SSC.Kind.${kind}`)})),
        facts: [...open.events].sort((a, b) => b.t - a.t).slice(0, 14).map(e => ({id: e.id, time: clock(e.t), text: factText(e)}))
      };
    }
    const last = pages.at(-1);
    const noteValue = open ? (open.note ?? "") : (last ? noteOfPage(last) : "");
    return {
      theme: setting("theme"),
      isGM: game.user.isGM,
      canWrite: active,
      canWriteNow: active && !!open,
      canEnd: active && !!open,
      hasJournal: !!journal(),
      session,
      noteValue,
      noteHint: open ? t("SSC.App.noteHintOpen") : (last ? t("SSC.App.noteHintLast", {name: last.name}) : t("SSC.App.noteHintNone")),
      pages: [...pages].reverse().map(page => {
        const flags = (page.flags?.[MODULE_ID] ?? {});
        const facts = flags.summary
          ? ["scenes", "fights", "levelUps", "items", "shown", "highlights"].reduce((sum, key) => sum + (flags.summary[key]?.length ?? 0), 0)
          : 0;
        return {id: page.id, name: page.name, number: flags.session?.number ?? "",
          summary: t("SSC.App.pageSummary", {players: flags.attendees?.length ?? 0, facts})};
      }),
      text: {
        current: t("SSC.App.current"), nobody: t("SSC.App.nobody"), noFacts: t("SSC.App.noFacts"),
        noSession: t("SSC.App.noSession"), noteLabel: t("SSC.App.noteLabel"), notePlaceholder: t("SSC.App.notePlaceholder"),
        write: t("SSC.App.write"), end: t("SSC.App.end"), openJournal: t("SSC.App.openJournal"),
        onlyActive: t("SSC.App.onlyActive"), past: t("SSC.App.past"), noPages: t("SSC.App.noPages"),
        previously: t("SSC.App.previously"), removeFact: t("SSC.App.removeFact")
      }
    };
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    addSettingsGear(frame);
    return frame;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.sscTheme = setting("theme");
    const field = this.element.querySelector(".ssc-note-field");
    field?.addEventListener("change", () => {
      const open = currentState().current;
      const last = sessionPages().at(-1);
      setNote(field.value, open ? "" : (last?.id ?? ""));
    });
  }

  static async #onWrite() {
    const page = await writeNow({manual: true});
    if ( page ) ui.notifications.info(t("SSC.App.written", {name: page.name}));
  }

  static async #onEnd() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: t("SSC.App.end")},
      content: `<p>${t("SSC.App.endConfirm")}</p>`,
      rejectClose: false, modal: false
    });
    if ( !confirmed ) return;
    const page = await endSession();
    ui.notifications.info(page ? t("SSC.App.ended", {name: page.name}) : t("SSC.App.endedEmpty"));
  }

  static #onOpenJournal() {
    journal()?.sheet?.render({force: true});
  }

  static #onOpenPage(event, target) {
    openPage(target.dataset.page);
    countFeature(MODULE_ID, "pageOpened");
  }

  static async #onPreviously(event, target) {
    await repostPreviously(target.dataset.page, {mode: "everyone"});
  }

  static async #onRemoveFact(event, target) {
    await removeFact(target.dataset.fact);
  }
}

/**
 * Open a session page in the journal.
 * @param {string} pageId
 */
export function openPage(pageId) {
  const entry = journal();
  const page = entry?.pages.get(pageId);
  if ( !page ) return;
  if ( !page.testUserPermission(game.user, "OBSERVER") ) {
    ui.notifications.warn(t("SSC.App.noAccess"));
    return;
  }
  entry.sheet.render({force: true, pageId});
}

/** The one open window, or null. */
let app = null;

/**
 * Open the window (or bring it to the front).
 * @returns {ChronicleApp}
 */
export function openChronicle() {
  app ??= new ChronicleApp();
  app.render({force: true});
  countFeature(MODULE_ID, "windowOpened");
  return app;
}

/**
 * Redraw the window when it is open.
 */
let redrawTimer = null;
export function refreshChronicle() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    if ( !isShown(app) ) return;
    // A note being typed is not thrown away by a redraw
    const field = app.element?.querySelector(".ssc-note-field");
    if ( field && (document.activeElement === field) ) return;
    app.render();
  }, 150);
}
