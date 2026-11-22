/**
 * The chronicle's part of the debug file of Sephral's modules: counts and states, no names or texts of the table.
 */

import {MODULE_ID, PARTNERS, partnerApi, setting, t} from "./config.mjs";
import {registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";
import {currentState, journal, sessionPages} from "./chronicle.mjs";
import {trace} from "./trace.mjs";

/**
 * What the module knows right now.
 * @returns {object}
 */
export function describeState() {
  const state = currentState();
  const session = state.current;
  const kinds = {};
  for ( const event of session?.events ?? [] ) kinds[event.k] = (kinds[event.k] ?? 0) + 1;
  return {
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    activeGM: !!game.users?.activeGM,
    session: session ? {number: session.number, started: new Date(session.started).toISOString(),
      last: new Date(session.last).toISOString(), facts: session.events.length, kinds,
      players: Object.keys(session.attendance).length, written: session.written, dirtyPage: !!session.dirtyPage,
      hasPage: !!session.pageId} : null,
    counter: state.counter,
    pending: state.pending || null,
    closedUntilEmpty: !!state.closedUntilEmpty,
    journal: journal()?.id ?? null,
    pages: sessionPages().length,
    partners: Object.fromEntries(Object.entries(PARTNERS).map(([key, id]) => [key, !!partnerApi(id)])),
    settings: Object.fromEntries(["recording", "recordAlone", "gapHours", "autoPage", "idleMinutes", "previously", "missed",
      "missedMinutes", "playerAccess", "partnerData", "highlights", "shown", "uiLanguage", "theme"]
      .map(key => [key, setting(key)]))
  };
}

/**
 * The button in the settings and the module's part of the file. Call in "init".
 */
export function registerDebug() {
  registerDebugMenu(MODULE_ID, {name: "SSC.DEBUG.Title", label: "SSC.DEBUG.Save", hint: "SSC.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SSC.DEBUG.Entry"),
    notice: file => t("SSC.DEBUG.Saved", {file}),
    recent: () => ({details: describeState()}),
    trace
  });
}
