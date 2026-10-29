"""
Speech-to-text for the Initial Assessment, using Whisper (faster-whisper) on this machine.
No audio is sent anywhere: the model runs locally (downloaded once from Hugging Face on first use).

    python scripts/whisper/transcribe.py <audio-file>

Env: WHISPER_MODEL (default "small"), WHISPER_LANGUAGE (e.g. "en"; empty = auto-detect),
     WHISPER_THREADS (default 0 = all cores).
Prints one JSON object per line: {"type":"progress","done":s,"duration":s} while working,
then {"type":"result","text":...,"language":...,"duration":...,"segments":[...]}.
"""
import json
import os
import sys

from faster_whisper import WhisperModel


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 2:
        emit({"type": "error", "message": "No audio file given"})
        sys.exit(2)
    model = WhisperModel(
        os.environ.get("WHISPER_MODEL") or "small",
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_THREADS") or 0),
    )
    segments, info = model.transcribe(
        sys.argv[1],
        language=os.environ.get("WHISPER_LANGUAGE") or None,
        vad_filter=True,
        beam_size=5,
    )
    duration = round(info.duration, 1)
    emit({"type": "progress", "done": 0, "duration": duration})
    out = []
    for s in segments:
        out.append({"start": round(s.start, 1), "end": round(s.end, 1), "text": s.text.strip()})
        emit({"type": "progress", "done": round(s.end, 1), "duration": duration})
    emit({
        "type": "result",
        "text": "\n".join(x["text"] for x in out if x["text"]),
        "language": info.language,
        "duration": duration,
        "segments": out,
    })


if __name__ == "__main__":
    main()
