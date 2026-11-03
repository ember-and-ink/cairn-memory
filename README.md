<p align="center">
  <img src="assets/banner.jpg" alt="Cairn Memory" width="800">
</p>

<p align="center">
  <a href="https://github.com/ember-and-ink/cairn-memory/actions/workflows/ci.yml"><img src="https://github.com/ember-and-ink/cairn-memory/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ember-and-ink/cairn-memory/actions/workflows/codeql.yml"><img src="https://github.com/ember-and-ink/cairn-memory/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <img src="https://img.shields.io/badge/SillyTavern-1.19.0%2B-blue" alt="SillyTavern 1.19.0+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
</p>

# Cairn-Memory

A memory extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern)
that keeps long roleplays on track. Other memory extensions keep a compressed
transcript that gets vaguer the longer you play. Cairn keeps the current state of
the story and the handful of events it can't do without.

**[Documentation](docs/README.md)** · **[All settings](docs/settings.md)** · **[Coming from Qvink Memory](docs/qvink-handover.md)**

## Is it for you?

- **Your long chats lose the thread.** Cairn summarises each message as you go and
  swaps old messages for their summaries, so the prompt stays a steady size.
- **The story's turning points get forgotten.** Cairn picks the few facts the story
  depends on (a death, a promise, a debt) and keeps them at the top of memory.
- **Characters change outfits or rooms at random.** Cairn tracks where the scene
  is, who is there, and what they look like, and puts that right above your newest
  message.
- **Lorebook entries come and go.** Once an entry triggers, Cairn keeps it in the
  prompt so a missed keyword doesn't drop it.
- **You pay for prompt caching.** Cairn only changes the prompt every few
  messages, so cached prefixes keep getting hit.

It is **not** for group chats, and it needs a second model to write memory.

## Quick start

**You need:**

- SillyTavern **1.19.0** or newer.
- A **second connection profile** for memory work. Use a capable model that isn't
  your roleplay model (GLM-4.7 class or better) with reasoning off. On OpenRouter
  Cairn turns reasoning off for you; elsewhere, turn it off in the profile's preset.

**Install:**

1. In SillyTavern, open **Extensions → Install extension** and paste:
   ```
   https://github.com/ember-and-ink/cairn-memory
   ```
2. Reload SillyTavern.
3. Open **Extensions → Cairn-Memory** and set **Connection profile** to your
   memory profile.

That's all. Send a message, and its summary appears underneath it. Everything else
is on by default. Until you pick a profile, Cairn does nothing.

> Already using **Qvink Memory**? Cairn reads its summaries, so you lose nothing.
> Two Qvink settings need changing first: see
> [Coming from Qvink Memory](docs/qvink-handover.md).

## Using it

Cairn runs in the background and never blocks sending. Each message gets a
summary, with a collapsed **World state** under it. In a message's actions menu:

- **Summarise with Cairn** (stacked cubes) redoes that message's summary.
- **Rebuild the world state** (stacked boxes) redoes the world state on that message.

**Last generation**, at the bottom of the settings panel, shows what Cairn put in
the prompt and why.

### The settings you might change

| Setting | When to change it |
|---|---|
| **Connection profile** | Always. It's the one required setting. |
| **Replace old messages with summaries** | Turn off if another memory extension should stay in charge of the prompt. Cairn keeps summarising either way. |
| **Track the world state** | Turn off if you track scene state some other way. Cairn already waits while WTracker is loaded. |
| **Keep canon** / **Canon entries** | Turn up the count for a very long story with a lot of threads. Default is 10. |
| **Adopt this chat** | Once, for a chat you started before installing Cairn. |

Everything else (budgets, prompts, diagnostics) is in
**[docs/settings.md](docs/settings.md)**. The defaults work.

## Contributing

Bug reports and ideas are welcome in
[issues](https://github.com/ember-and-ink/cairn-memory/issues). Please open an
issue before a non-trivial PR. See [CONTRIBUTING](.github/CONTRIBUTING.md) and
[docs/development.md](docs/development.md).

## License

MIT. See [`LICENSE`](LICENSE).
