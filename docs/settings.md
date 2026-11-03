# Settings

Everything in **Extensions → Cairn-Memory**, in the order the panel shows it.
Every setting has a default that works, and the only one you have to set is
**Connection profile**.

| Setting | Default | What it does |
|---|---|---|
| Enabled | On | Turns Cairn off without uninstalling it. Memory already written is kept. |

## Memory model

| Setting | Default | What it does |
|---|---|---|
| Connection profile | *none* | The profile Cairn uses to write summaries, the index, canon and the world state. It must not be your roleplay model. Until you pick one, Cairn does nothing. |
| Reasoning | None | How much the memory model thinks first: **None**, **Low**, or **As the profile's preset says**. Memory work doesn't need it, and thinking is slow and billed. Cairn can set this only on OpenRouter. On other sources, set reasoning in the profile's preset. |
| Tell it the chat is fiction | On | Starts each memory request by saying the chat is a collaborative story, so the model reads it as one. |

## What Cairn keeps

| Setting | Default | What it does |
|---|---|---|
| Replace old messages with summaries | On | Cairn puts the summaries in the prompt and takes out the messages they cover. While Qvink Memory is still injecting its own block, Cairn waits, and the inspector says what it is waiting for. See [Coming from Qvink Memory](qvink-handover.md). |
| Track the world state | On | Where the scene is, who is there, the weather, and each character's hair and outfit, placed just above your newest message. Waits while WTracker or WTrackerLite is loaded. |
| Keep canon | On | Picks the few facts the whole story depends on (a death, a promise, a debt) and keeps them at the top of memory. The pick is redone as the story grows. |
| Canon entries | 10 | How many canon facts to pick, from 1 to 16. |
| Drop example dialogue once summarised | On | Drops the card's example dialogue once summaries cover the early chat. Off leaves SillyTavern's own setting alone. |
| Hold lorebook entries | On | Once a lorebook entry triggers, it stays in the prompt until the budget pushes it out, instead of dropping when a keyword misses. Off restores stock SillyTavern behaviour. |

## Advanced settings

Collapsed by default. You shouldn't need any of these.

### Memory budget

Each share is a ceiling. Anything canon or the one-line summaries don't use goes
back to full summaries.

| Setting | Default | What it does |
|---|---|---|
| Memory, % of the prompt | 35 | The most of the prompt the memory block may take. |
| Canon, % of memory | 20 | The most of the memory block canon may take. |
| One-line summaries, % of summaries | 20 | More one-liners reach further back. Fewer keep recent summaries in full. |
| Recent messages kept in full | 8 | How many of the newest messages stay in the prompt as they were written. |
| Messages per summary step | 8 | How many messages build up before they are swapped for summaries. Bigger steps change the prompt less often, which keeps the cache warm. |
| Lorebook cap, tokens | 3500 | The most the lorebook may take. What it frees goes to memory. **0** leaves SillyTavern's budget alone. This writes SillyTavern's own setting, so it applies to every chat. |

Changing **Recent messages kept in full** or **Messages per summary step**
rebuilds memory once.

### Memory prompts

The four prompts the memory model is sent. Each has **Reset to default**. An edit
that drops a required placeholder falls back to the default, and editing a prompt
doesn't rewrite memory that is already written.

| Prompt | Placeholders |
|---|---|
| Summary prompt | `{{message}}` the message, `{{history}}` the summaries just before it. |
| Index prompt | `{{summaries}}` the numbered list of up to fifteen summaries (required). |
| Canon prompt | `{{index}}` the whole index (required), `{{slots}}` the number of canon entries. |
| World state prompt | `{{state}}` the record so far and `{{messages}}` the new messages (both required), `{{earlier}}` the summaries before them. |

### Adopt this chat

For a chat started before Cairn. **Adopt this chat…** works through the chat from
its first message as if Cairn had been on all along, using Qvink's summaries where
they exist. **Redo from scratch…** summarises every message again and rebuilds the
index and canon from nothing, for an old chat you want redone on today's model.
Both make many memory-model calls, so Cairn tells you how many and asks first.
**Stop adopting** cancels a run in progress.

### Diagnostics

| Setting | Default | What it does |
|---|---|---|
| Show last generation | On | Shows the **Last generation** inspector: what Cairn put in the prompt, from where, and how stable the prompt is. |
| Log each generation to disk | On | One file per chat at `user/files/cairn-<chat>-<id>.jsonl`, kept across sessions. |
| Debug logging | Off | Verbose browser-console output. Only needed for bug reports. |

## Last generation

The folded panel under the settings. It shows what was injected and where it came
from, how stable the prompt is between turns, the canon currently in the prompt, and
on the **Writing** line, whether Cairn is writing the memory block or what it is
waiting for.
