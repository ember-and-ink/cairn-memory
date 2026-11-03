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
| Connection profile | *none* | The profile Cairn uses to write summaries, the index, canon and the world state. Any capable general-purpose model works, including your roleplay profile; a cheaper separate one saves money, and roleplay finetunes are the thing to avoid. When it is the chat's own profile, the panel says so. Until you pick one, Cairn does nothing. |
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

Collapsed by default. The memory budget is the only part most people change, so it
is always open at the top; the rest are folds.

### Memory budget

A table of percentages with the tokens each one comes to at your context size. Every
row is a **ceiling**, not what a chat will use. Canon or one-liners that don't fill
their share go to full summaries, and a long card or long messages leave memory less.
What a chat actually got is under **Last generation**. The table updates when you
switch connection profile and at each generation.

| Row | Default | What it does |
|---|---|---|
| Max prompt | — | Your context size less the reply length, from SillyTavern. Read-only. |
| Memory | 35% of the prompt | The most of the prompt the memory block may take. |
| Canon | 20% of memory | The most of the memory block canon may take. |
| One-line summaries | 20% of summaries | More one-liners reach further back. Fewer keep recent summaries in full. |
| Full summaries | the rest of memory | Read-only. |
| Lorebook | 11% of the prompt | The most the lorebook may take. What it frees goes to memory. Cairn writes it, as tokens, into SillyTavern's **World Info budget cap**, for every chat, and overwrites a hand edit there while Cairn is on. **0**, or turning Cairn off, gives SillyTavern its previous cap back. |
| Safety margin | 5% | Fixed. Room for what no estimate sees. |
| Card, persona, recent messages | the rest | Read-only. Everything else in the prompt. |

Below the table, two message counts:

| Setting | Default | What it does |
|---|---|---|
| Recent messages kept in full | 8 | How many of the newest messages stay in the prompt as they were written. It doesn't grow with your context: on a large context you can raise it, but it costs tokens every turn. |
| Messages per summary step | 8 | How many messages build up before they are swapped for summaries. Bigger steps change the prompt less often, which keeps the cache warm. |

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
| Log each generation to disk | Off | One file per chat at `user/files/cairn-<chat>-<id>.jsonl`, kept across sessions. |
| Debug logging | Off | Verbose browser-console output. Only needed for bug reports. |

## Last generation

The folded panel under the settings. It shows what was injected and where it came
from, how stable the prompt is between turns, the canon currently in the prompt, and
on the **Writing** line, whether Cairn is writing the memory block or what it is
waiting for.
