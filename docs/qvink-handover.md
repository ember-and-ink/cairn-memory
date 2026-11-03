# Coming from Qvink Memory

Cairn reads the summaries Qvink Memory has already written, so there's nothing to
migrate and nothing is lost.

## Let Cairn take over the prompt

In **Qvink Memory**:

1. Set **short-term** and **long-term memory position** to **Macro Only**. Qvink
   keeps building its block, but SillyTavern stops placing it.
2. Turn off **Exclude messages after threshold**.

Qvink can keep summarising, and Cairn keeps reading what it writes.

## Let Cairn write the summaries too

**Back up your chats**, then turn off Qvink's **Auto Summarize**. Cairn starts
after the newest summary Qvink wrote and never changes any of Qvink's. Each summary
is saved on its message, so it survives uninstalling Qvink.

Disabling or uninstalling Qvink does all of the above at once.

## Checking it worked

Open **Last generation** at the bottom of Cairn's settings. The **Writing** line
says whether Cairn is writing the memory block and, if not, exactly what it is
waiting for.

For a chat that predates both, **Adopt this chat** (under Advanced settings) brings
it up to date and uses Qvink's summaries where they exist. See
[Settings](settings.md#adopt-this-chat).
