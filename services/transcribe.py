import io
import json
import logging
import math
import struct
import time
import uuid
import wave

import requests

from config import Config
from services.meta_client import transcribe_model

log = logging.getLogger(__name__)

TRANSCRIBE_URL = Config.META_API_BASE_URL.rstrip("/") + "/asr/transcribe"

MAX_BYTES = 32 * 1024 * 1024  # 32 MB
MAX_SECONDS = 10 * 60  # 10 minutes
OK_SAMPLE_RATES = (16000, 24000)


class TranscribeError(Exception):
    """The message is safe to show to the user."""


def _prepare_wav(audio_bytes):
    """Checks the recording BEFORE we upload it, then rebuilds it as a plain, clean WAV.

    Some tools (like Apple's afconvert) add extra chunks to the WAV header. Python reads those
    fine, but Meta's parser is strict and rejects the file. Rewriting the audio into a basic
    header (nothing but the format info and the sound) avoids that.
    """
    if not audio_bytes:
        raise TranscribeError("The recording was empty.")
    if len(audio_bytes) > MAX_BYTES:
        raise TranscribeError("That recording is too big. Try a shorter one.")

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            rate = wav.getframerate()
            frames = wav.getnframes()
            pcm = wav.readframes(frames)
    except (wave.Error, EOFError):
        raise TranscribeError("That recording isn't a valid WAV file.")

    if channels != 1 or sample_width != 2 or rate not in OK_SAMPLE_RATES:
        raise TranscribeError(
            "Audio must be mono, 16-bit WAV at 16 or 24 kHz "
            f"(this one is {channels} channel(s), {sample_width * 8}-bit, {rate} Hz)."
        )

    seconds = frames / rate
    if seconds == 0:
        raise TranscribeError("The recording was empty.")
    if seconds > MAX_SECONDS:
        raise TranscribeError("That recording is longer than 10 minutes. Try a shorter one.")

    clean = io.BytesIO()
    with wave.open(clean, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return clean.getvalue()


def _post(audio_bytes, language_bias=None):
    """Sends the audio to Meta and returns the full JSON response."""
    request_part = {
        "model": transcribe_model(),
        "audioEncoding": "WAV",
        # PUSH_TO_TALK = one controlled recording, which is exactly our mic button
        "mode": "PUSH_TO_TALK",
    }
    if language_bias:
        # a list of language names, e.g. ["English"]. Leave it out and Meta detects the language.
        request_part["languageBias"] = language_bias
    # We don't send "keywords" for now. Another developer found they can make the model
    # repeat words on short clips. We can test them later for names.

    headers = {"Authorization": f"Bearer {Config.META_API_KEY}"}

    # Meta says the session id is the only handle support can use to look up a problem,
    # so we make one per request and put it in every log line.
    session_id = f"unpile-{uuid.uuid4()}"

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        files = {
            "request": (None, json.dumps(request_part), "application/json"),
            "audio": ("audio.wav", audio_bytes, "audio/wav"),
        }
        try:
            response = requests.post(
                TRANSCRIBE_URL,
                params={"sessionId": session_id},
                headers=headers,
                files=files,
                timeout=60,
            )
        except requests.RequestException:
            log.exception("Could not reach the transcription service (session %s)", session_id)
            raise TranscribeError("Couldn't reach the transcription service. Please try again.")

        status = response.status_code
        if status == 200:
            return response.json()

        # 429 = rate limited: Meta says retry with exponential backoff (1s, 2s)
        if status == 429 and attempt < max_attempts:
            log.warning("Transcribe rate limited (session %s), retrying", session_id)
            time.sleep(2 ** (attempt - 1))
            continue

        # 500 = Meta says retry once, then give up
        if status >= 500 and attempt < 2:
            log.warning("Transcribe got %s (session %s), retrying once", status, session_id)
            time.sleep(1)
            continue

        log.error("Transcribe failed (session %s): %s %s", session_id, status, response.text[:500])
        if status in (401, 403):
            raise TranscribeError("The app's Meta API key isn't working.")
        if status == 413:
            raise TranscribeError("That recording is too big. Try a shorter one.")
        if status == 429 or status >= 500:
            raise TranscribeError("The transcription service is busy. Please try again in a moment.")
        raise TranscribeError("The transcription service couldn't read that recording.")

    raise TranscribeError("The transcription service is busy. Please try again in a moment.")


def _extract_text(data):
    """Pulls the transcript out of Meta's response.

    Meta's docs: "transcript" is the complete transcript in every mode.
    (In PUSH_TO_TALK the "turns" list is empty.)
    """
    transcript = data.get("transcript")
    if isinstance(transcript, str):
        return transcript.strip()

    log.warning("Transcribe response had no transcript. Keys: %s", list(data.keys()))
    return ""


def transcribe_wav(audio_bytes, language_bias=None):
    """Main function. Takes WAV bytes, returns the transcript as a string ("" if no speech)."""
    clean = _prepare_wav(audio_bytes)
    data = _post(clean, language_bias=language_bias)
    return _extract_text(data)


def _make_test_wav():
    """One second of a 440 Hz tone, 16 kHz mono 16-bit, just to prove the plumbing works."""
    rate = 16000
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        samples = (int(8000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(rate))
        wav.writeframes(b"".join(struct.pack("<h", s) for s in samples))
    return buffer.getvalue()


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            audio = f.read()
    else:
        audio = _make_test_wav()

    clean = _prepare_wav(audio)
    print(f"WAV size: {len(audio)} bytes -> {len(clean)} bytes after cleaning")
    # prints Meta's raw response, so we can see exactly what it looks like
    print(json.dumps(_post(clean), indent=2))