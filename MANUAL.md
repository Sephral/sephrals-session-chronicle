# Sephral’s Session Chronicle: Manual

Session Chronicle keeps a record of every game night and writes it up for you. While players are online it notes what happens, at the end it writes one page in a journal called *Chronicle*, at the start of the next session it shows everyone a card *Previously*, and a player who comes late gets a private card *What you missed*. Nothing is written by an AI: every sentence is built from the facts and a fixed wording, so the page says exactly what happened and nothing else. You add a line of your own, and that line is the part that reads like a story.

## What it records

The module records on the active GM's computer, from Foundry's own events, and needs no setup and no other module:

| What | How it shows on the page |
| --- | --- |
| Who was at the table | *At the table*: each player with the character, and a note for players who joined late |
| Scenes | *Where the party went*: the scenes the party was on, with the number of visits when they came back |
| Fights | *Fights*: the scene, the number of rounds, the foes that were defeated and the heroes who went down |
| Level ups | *Level ups*: a character that reached a new level |
| Items | *Loot and items*: what a player's character gained, merged per item |
| Shown pictures and handouts | *Shown at the table*: every picture and every journal you show to the players |
| Big rolls | *Big moments*: natural 20s and natural 1s on the first d20 of a public roll of a player's character |

Some things are left out on purpose. Whispers, blind rolls and rolls of monsters are never noted. Hidden combatants are not named. Class features, spells and the like are not loot. Scenes are noted only while a player is online, so your preparation does not turn into a session.

Level ups and items work in every game system that gives its characters a level or items. Natural 20s and natural 1s need a d20, so they show up in Dungeons and Dragons, Pathfinder and the like.

## When a session starts and ends

A session starts with the first thing that happens while a player is online. It ends when nothing has happened for the *Hours between two sessions* (six by default). Foundry has no sessions of its own, so the module finds them from the gap, also across midnight.

The page of a session is written

* when nothing has happened for a while (*Minutes of quiet before writing*, thirty by default) or when the last player leaves, if *Write the page by itself* is on
* when you click *Write page now* in the window
* for the last time when the session ends, which is when you click *End session* or when something happens after the gap

A page that is written early is updated in place when the session goes on. After it is final, the module leaves the page alone and you can edit it like any journal page. If you edit a page by hand while the session is still running, the module keeps your text and only updates its own data.

A session in which nobody took part and nothing happened leaves no page.

## The window

*Session Chronicle* opens from the token controls, from the button above the journal list, from the settings or with `api.open()`. Players see the list of past sessions and open their pages. The GM also sees:

* the running session: when it began, who is online, how many facts of each kind were noted and the latest facts. The small cross takes a fact out of the page, for a roll or an item you do not want to mention
* a field *A line from you for the page*. It goes at the top of the page and on the card *Previously*. Without a running session the field belongs to the last finished page and changes it
* *Write page now* and *End session*. Only the active GM can use them. Ending a session asks first. Players who are still online do not start a new session by themselves, the next thing that happens does
* *Open journal*

Every window has the settings gear in the title bar.

## The card Previously

When a new session starts, a card in the chat tells everyone what happened last time: your line, the fights, big moments, level ups, loot, what was shown and where the party went, at most seven lines, and a button that opens the full page. The card waits until a player is online. With *Previously card* you choose *Show to everyone*, *Show to me only* or *Do not show*. In the window the book button of a page shows its card again to everyone.

## What you missed

A player who joins after the session began, or comes back after a break, gets a private card with what happened in the meantime. A player who was away for less than *Minutes before a player has missed something* (ten by default) gets nothing, and neither does a player when nothing happened. A player who also missed the session before gets its story on the card. Only that player can see the card. Switch it off with *What you missed*.

## Other Sephral modules

When these modules are active, their data goes on the page without any setup (switch it off with *Use other Sephral modules*):

* **Combat Log and Stats**: the numbers of the night's fights under *Fights*, as players may see them: number of fights and rounds, damage, healing, foes defeated, heroes down, critical hits and the hero of the night
* **Campaign Album**: the photos taken during the session, up to six
* **Loot Ledger**: the loot the party found, in *Loot and items*

## Who may read the Chronicle

The journal *Chronicle* is created with the first page. With *Players may read the Chronicle* on (the default) every player can open the pages. Switch it off and only the GM can. The card *Previously* then has no open button, but it still tells players a short version in the chat, turn that off with the setting *Previously card*. The pages contain the names of scenes as players know them, the names of defeated foes and of pictures and handouts you showed, so they hold nothing the players have not seen. Items that a game system marks as unidentified are listed under their cover name, or left out when there is none. A scene is named by its navigation name when it has one, so give a scene a navigation name if its real name would give something away.

## Settings

| Setting | What it does |
| --- | --- |
| Module language | The language of the module on this device, or like Foundry. Pages and cards come out in the language of the GM who records |
| Look | Paper (Signature) or dark (Foundry) for the window and the cards |
| Record game nights | Switches the recording off or on |
| Record without players | Also note facts when you are the only one online. Off by default |
| Hours between two sessions | Quiet time that ends a session. Default 6 |
| Write the page by itself | Write the page after a quiet time or when the last player leaves |
| Minutes of quiet before writing | Default 30 |
| Previously card | Everyone, only me, or off |
| What you missed | The private card for late players |
| Minutes before a player has missed something | Default 10 |
| Players may read the Chronicle | Journal readable by players |
| Use other Sephral modules | Data of Combat Log and Stats, Campaign Album and Loot Ledger |
| Note natural 20s and 1s | Big moments |
| Note shown pictures and handouts | Shown at the table |

## Self test

*Run self test* in the module settings (GMs) checks after an update that everything the module relies on in Foundry is there: journals, chat, permission levels, users, the sockets for shown pictures, scenes and combats, the template and the texts, and runs the rules on a small example. It writes nothing. It also lists which other Sephral modules it found. The result goes to a notification and a whisper to you. The module remembers the Foundry version it was verified with and tells you once when Foundry is newer.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message.

The file contains chat text and whispers. Check it before you share it. For Session Chronicle it holds counts and states of the running session, the settings and the latest decisions of the module, no names or texts of your table.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub. If the GM agreed to the usage statistics, the window also counts how it is used: opened, the other modules shown, a video or install link of one of them, a module installed or switched on from it. It never records which module.

## Macro API

`game.modules.get("sephrals-session-chronicle").api`

| Call | Does |
| --- | --- |
| `open()` | Opens the window. |
| `openPage(pageId)` | Opens a session page in the journal. |
| `journal()` | The journal *Chronicle*, or `null` before the first page. |
| `pages()` | The session pages in order: `id`, `uuid`, `name`, the `session` (number, start, end, final), the `summary`, the `attendees` and the GM's `note`. |
| `state()` | A copy of the running session, the number of the last page and what waits. |
| `record(fact)` | Active GM. Notes a fact of your own: `{k: "scene", name}`, `{k: "shown", what: "image"` or `"journal", title}`, `{k: "level", actor, to}`, `{k: "item", actor, name, qty}`, `{k: "roll", kind: "crit"` or `"fumble", who}`. Returns the stored fact, or `null` when nothing was recorded. |
| `writeNow()` | Active GM. Writes the page of the running session without ending it. |
| `endSession()` | Active GM. Ends the running session and writes its final page. |
| `previously(pageId, {mode})` | Active GM. Posts the card *Previously* of a page again, `mode` is `"everyone"` or `"gm"`. |
| `scan()` | Active GM. Looks at who is online now. |
| `samples()` | Sample windows with a made-up game night, for translators and testers: the window, a session page, the chat cards and the end question. Each entry has an `open()` that shows it. Nothing is saved or posted, and the other Sephral modules are not needed. |
| `runSelfTest()` | GM. Runs the self test. |
| `saveDebugFile()` | GM. Saves the debug file. |

## Limits

* Only the active GM records. If two GMs are online, the one Foundry names the active GM does it, and another GM takes over when the active one leaves. The record is kept in the world, so nothing is lost when that happens.
* The module records only while the active GM's browser is open. A session without the GM leaves no record, and what happens while the GM's browser is closed is not noted.
* A pause shorter than the gap, such as the evening break, stays in the same session. Two game nights closer together than the gap, for example on one weekend with a short night between, are one session. Lower *Hours between two sessions* for that, or end the session yourself.
* Natural 20s and natural 1s are found on d20 rolls. Rolls that another module hides from the chat message are not seen.
* Shown pictures and handouts are noticed through Foundry's own show button and the same call other modules use. A module that shows pictures in a way of its own is not seen.
* The level of a character is found in the usual places of the game systems. A system that keeps it elsewhere shows no level ups.
* The text of a page is built in the language of the GM who writes it. A page written in English stays English when you change the language later.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Session Chronicle it holds:

* on how many of the last 30 days the module was used
* how many pages were written by itself and by hand, how many sessions the GM ended, how often the card *Previously* was shown by itself and again, how many private cards *What you missed* were sent, and how often the GM saved a line, took a fact out of a page, opened the window or a page
* the settings *Record game nights*, *Hours between two sessions*, *Previously card*, *What you missed*, *Players may read the Chronicle*, *Write the page by itself* and *Use other Sephral modules* (only the chosen option)
* where errors occur in the module code: file, line, error type and whether the error arose in the module itself, in Foundry, in the game system or in another module, never the error message or the name of another module

No names, notes, pictures or other content of the world are sent.
