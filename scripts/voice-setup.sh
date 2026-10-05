#!/usr/bin/env bash
# Optional voice mode: installs local speech-to-text (Whisper) and text-to-speech (Kokoro) for Pocket Code.
# Everything runs on this machine; no audio or text is sent to a speech service. About 1.5 GB on disk, ~1 GB RAM
# while voice is in use (Pocket stops the voice process after it has been idle).
#
#   bash scripts/voice-setup.sh            # installs into $POCKET_VOICE_HOME (default ~/.local/share/pocket-code/voice)
#
# Then restart Pocket Code. Settings → Voice shows whether it is available.
set -euo pipefail
HOME_DIR="${POCKET_VOICE_HOME:-$HOME/.local/share/pocket-code/voice}"
STT_MODEL="${VOICE_STT_MODEL:-small.en}"
REQ="$(cd "$(dirname "$0")/.." && pwd)/voice/requirements.txt"
KOKORO=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
mkdir -p "$HOME_DIR/models/whisper"
if [ ! -x "$HOME_DIR/venv/bin/python" ]; then python3 -m venv "$HOME_DIR/venv"; fi
"$HOME_DIR/venv/bin/pip" install -q --upgrade pip
"$HOME_DIR/venv/bin/pip" install -q -r "$REQ"
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "$HOME_DIR/models/$f" ]; then
    curl -fsSL -o "$HOME_DIR/models/$f.part" "$KOKORO/$f" || { echo "Download failed: $KOKORO/$f"; exit 1; }
    mv -f "$HOME_DIR/models/$f.part" "$HOME_DIR/models/$f"
  fi
done
"$HOME_DIR/venv/bin/python" - <<PY
from faster_whisper import WhisperModel
WhisperModel("$STT_MODEL", device="cpu", compute_type="int8", download_root="$HOME_DIR/models/whisper")
print("Whisper $STT_MODEL ready")
PY
echo "Voice installed in $HOME_DIR. Restart Pocket Code to enable it."
