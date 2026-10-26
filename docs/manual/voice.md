<!-- manual
checked: 1.79.2
sources: voice.mjs, voice/, public/voice.js, public/voice-text.js, public/voice-worklet.js, scripts/voice-setup.sh
-->
# Voice mode (beta)

Voice mode lets you speak to a conversation and hear its reply read aloud. The mic sends one spoken message; the headset starts a hands-free conversation that reads each reply and listens for your answer. Speech-to-text (Whisper) and text-to-speech (Kokoro) run in a process on your Pocket Code server, so no audio or text goes to a speech service. It is optional and in beta: its timing and wording are still being tuned.

## Set it up

Voice needs a one-time install on the server, then a restart.

1. From the Pocket Code directory, run:

   ```bash
   bash scripts/voice-setup.sh
   ```

   It needs `python3`. It creates a Python virtual environment, installs `faster-whisper`, `kokoro-onnx`, `onnxruntime` and `numpy`, and downloads the Kokoro voice model and the Whisper `small.en` speech model into `POCKET_VOICE_HOME` (default `~/.local/share/pocket-code/voice`). The script's own estimate is about 1.5 GB on disk.
2. Restart Pocket Code.
3. Open **Settings → Notifications & voice → Voice (beta)**. It reads "Voice is available on this server." when the install worked.

Until the engine is installed, the mic and headset buttons stay hidden. Voice settings are kept per browser, so set them on each device you use.

### Server settings

| Variable | Default | Effect |
|---|---|---|
| `POCKET_VOICE` | on | Set to `off` to turn voice off even when it is installed. |
| `POCKET_VOICE_HOME` | `~/.local/share/pocket-code/voice` | Where the setup script installs, and where Pocket looks for the engine. Set it the same way for both. |
| `POCKET_VOICE_IDLE_MS` | `900000` (15 minutes) | How long the engine stays loaded after its last use. A value that is not a positive number means the default. |
| `POCKET_VOICE_COMMAND` | none | A JSON array of strings that replaces the command starting the engine, for tests or a custom engine that speaks the same HTTP API. A malformed value turns voice off with the reason shown in Settings. |
| `VOICE_STT_MODEL` | `small.en` | The Whisper model. The setup script downloads this model; the engine reads the same variable from Pocket's environment, so set it in both places. |
| `VOICE_STT_THREADS`, `VOICE_TTS_THREADS` | `4` | CPU threads for transcription and for speech, read from Pocket's environment. |

## Use it

### Speak one message with the mic

The mic sits beside **Send** in every conversation and in **New conversation**.

- **Tap** the mic and speak. It sends when you pause. Tap it again to finish early, or **Cancel** to discard.
- **Hold** the mic for push-to-talk and release to send.

The plain mic sends one message and does not listen again. While a reply is running, a spoken message is delivered the same way a typed one would be. In **New conversation**, what you say starts the conversation.

Pocket never sends on your behalf when:

- **Review before sending** is on: what you said goes into the message box for you to send.
- The message box already has a typed draft: your words are added to the end of it.
- The message looks like it contains a password or key: the [secret check](vault.md#catch-secrets-typed-into-messages) holds it and opens its sheet.

### Have a hands-free conversation

Tap the headset beside the mic. Pocket listens for your instruction, then reads it back ("Ready to send: …") and waits:

| To | Say | Or tap |
|---|---|---|
| Send it | "send it", "yes", "go ahead", "do it", "okay" | **Send** |
| Drop it | "cancel", "no", "never mind", "scratch that" | **Cancel** |
| Edit it in the message box | "edit", "let me change it", "I'll type it" | **Edit** |

Saying anything else replaces the instruction and it is read back again. Only short replies count, so a sentence that contains "yes" is not taken as consent. Nothing reaches the agent without that yes.

After you send, the reply is read aloud and the mic reopens for your answer. It waits as long as **Hands-free: wait for my reply** allows (2 minutes by default) so you can read the rest of the reply first. Hands-free ends when you tap the headset again, tap **Cancel**, **Stop** or **End hands-free**, switch conversations, or stay quiet past the wait. It never turns on by itself, and the headset hides while you have a typed draft.

A hands-free conversation started in **New conversation** carries on in the conversation it starts.

### Quick commands

Short phrases are answered on your device, without the agent:

| Say | What happens |
|---|---|
| "what's it doing", "status", "where are we" | The latest step if a reply is running, otherwise a summary of the last reply |
| "stop", "cancel", "abort" | Stops the running reply |
| "read it", "what did it say", "repeat that" | Reads the latest reply at your **Spoken reply length** |
| "read it all", "read me everything" | Reads the whole reply |
| "what's waiting on me", "what needs me" | Approvals and questions here, and other conversations that need you |
| "be quiet", "stop talking", "enough" | Stops speaking and ends hands-free |
| "mute", "voice off", "stop speaking" | Mutes voice on this device |
| "unmute", "voice on" | Turns voice back on |

A leading "okay", "hey", "so" or "pocket" and a trailing "please" are ignored. Anything longer than nine words, or different, is sent to the conversation as a normal message.

### Hear replies

With **Speak replies** on, a reply to a message you sent by voice is read aloud when it finishes, if that conversation is still open. **Spoken reply length** sets how much:

- **Brief: one sentence**
- **Normal: about two sentences** (default)
- **Detailed: the whole reply**, stopping after about 2,500 characters, roughly three minutes ("The rest is on screen.")

Code blocks, tables and images are left on screen; links are read as their text and bare addresses as "a link"; file paths are read as their last part. The setting changes how much is read, not what the agent writes. If the agent needs an approval or has a question, you hear "It needs your approval. Review it on screen." or "It has a question for you on screen." You answer on screen; voice does not approve anything.

### Announce other conversations

**Announce conversations** says when any conversation finishes, stops with an error, or needs your approval or answer, while Pocket is open, in place of the chime:

- **Off** (default)
- **Conversation name only**: "The Website redesign conversation finished."
- **Name and a one-line summary**: adds the first sentence of the reply.

Announcements wait until you finish speaking or a reply finishes, are said once even with several Pocket tabs open, and never turn on the mic. Muted conversations stay quiet, and in split view only the main window speaks. Push notifications remain the way to hear about work while Pocket is closed.

### Mute voice on this device

When voice is available, the row above the message box has a **Voice** chip beside **Alerts** (an icon beside the bell while a reply runs). One tap mutes every spoken reply, announcement and prompt on this device, stops anything being spoken and ends hands-free. Your other voice settings are kept and apply again when you unmute. While muted, quick commands show their answer in the voice strip instead of speaking it, and **Play a sample** still plays. Starting hands-free or saying "unmute" turns voice back on.

### Voice settings

All in **Settings → Notifications & voice → Voice (beta)**, saved in this browser:

| Setting | Default |
|---|---|
| **Mute voice on this device** | Off |
| **Speak replies** | On |
| **Spoken reply length** | Normal |
| **Review before sending** | Off |
| **Announce conversations** | Off |
| **Hands-free: wait for my reply** (30 seconds, 1 minute, 2 minutes, 5 minutes) | 2 minutes |
| **Voice**: American female, American female (Bella), American male, British female, British male (George), British male (Lewis) | American female |
| **Names and terms to recognize** | Empty |
| **Play a sample** | |

**Names and terms to recognize** is a hint for the recognizer: project names, product codes, people's names. Pocket also adds "Pocket Code, Claude, Codex" and the titles of your recent conversations.

## How it works

The browser records the microphone, detects when you stop speaking, converts the audio to 16 kHz mono and sends it to the Pocket server. The server passes it to the engine (`voice/voice_server.py`), which listens only on `127.0.0.1` on a random port. Replies to be spoken are sent to the engine in short pieces, the first one small so audio starts quickly. Audio and text are processed in memory and not stored. The voice routes need you to be signed in.

The engine starts on the first voice request, which takes a few seconds, and stops after `POCKET_VOICE_IDLE_MS` without use. It exits on its own if Pocket stops. The setup script notes about 1 GB of memory while voice is in use; no GPU is needed.

| Limit | Value |
|---|---|
| One spoken message | 60 seconds, then it is sent |
| Audio the engine accepts | 90 seconds |
| Shortest recording | 0.3 seconds ("That was too short to hear.") |
| Tap with no speech | Stops after 10 seconds ("I didn't hear anything.") |
| End of speech | About 1 second of silence |
| Language | English |

### Browser and device requirements

- **HTTPS.** Browsers allow the microphone only on a secure connection.
- **Microphone permission** for the Pocket Code site.
- **An embedding page** (Pocket inside another site's frame) must grant the frame microphone access (`allow="microphone"`); otherwise open Pocket Code directly.
- **A first tap.** Browsers play sound only after you have tapped or clicked the page once. An announcement that arrives before that waits for your first tap.
- The screen is kept awake while voice is active, where the browser supports it.

## For agents

Voice mode has no CLI and no agent-side controls. A spoken message reaches you as an ordinary user message, transcribed, so expect occasional mis-heard words and no punctuation cues; ask when a transcription is ambiguous. To check whether voice is installed on the server, look for the engine in `POCKET_VOICE_HOME` (default `~/.local/share/pocket-code/voice`) or ask the user to open **Settings → Notifications & voice → Voice (beta)**. To install it for the user, run `bash scripts/voice-setup.sh` from the Pocket Code directory and tell them Pocket Code must be restarted; do not restart it without their say-so.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No mic or headset button | The engine is not installed, or `POCKET_VOICE=off` | Run `scripts/voice-setup.sh` and restart. Settings → Voice (beta) shows the reason. |
| Settings says "Voice is not installed on this server" after running the script | `POCKET_VOICE_HOME` differs between the script and Pocket, or Pocket was not restarted | Use the same `POCKET_VOICE_HOME` for both, then restart. |
| Settings says "Voice is off: POCKET_VOICE_COMMAND is …" | `POCKET_VOICE_COMMAND` is not a JSON array of strings | Fix or remove it and restart. |
| "Voice needs HTTPS." | Pocket is opened over plain HTTP | Open it through your HTTPS address. |
| "Microphone permission is off." | The browser blocked the microphone | Allow it for this site in the browser's settings. |
| "The microphone is blocked in this embedded view." | The embedding page does not grant microphone access | Open Pocket Code directly. |
| "Tap anywhere to turn on spoken replies and alerts." | The browser has not had a tap yet | Tap the page once. |
| The first message after a while takes several seconds | The engine was idle and is loading | Wait; later requests are quick. |
| "The voice engine did not start in time." or "exited during startup" | The engine could not load (missing models, broken install) | Rerun `scripts/voice-setup.sh`, then restart. Also rerun it after an upgrade that changes `voice/requirements.txt`. |
| "The reply could not be spoken. It's on screen." | The engine failed to synthesize | Read the reply on screen; try **Play a sample** in Settings. |
| "You switched conversations, so that wasn't sent." | You left the conversation while it was transcribing | Go back and speak again. |
| A spoken message lands in the box instead of sending | **Review before sending** is on, or there was a typed draft | Send it yourself, or turn off **Review before sending**. |
| "That sounded like a password or key, so it was not sent." | The secret check held the message | Choose **Store and send**, **Send as is** or **Edit** in the sheet. |
| Names come out wrong | Whisper does not know them | Add them to **Names and terms to recognize**. |
