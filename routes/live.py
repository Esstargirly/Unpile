import json
import logging
import threading

from flask import session
from simple_websocket import ConnectionClosed
from websockets.sync.client import connect

from config import Config
from extensions import db, sock
from models import User
from services.meta_client import transcribe_model

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_SECONDS = 5 * 60  # same cap as the recorder in the browser


def _meta_url():
    base = Config.META_API_BASE_URL.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return base + "/asr/realtime"


def _send(ws, payload):
    try:
        ws.send(json.dumps(payload))
    except Exception:
        pass  # the browser has gone, nothing to tell


def _fail(ws, message):
    _send(ws, {"type": "error", "message": message})
    try:
        ws.close()
    except Exception:
        pass


@sock.route("/ws/live")
def live(ws):
    # only logged-in users. Check, then let go of the database connection straight away,
    # because this socket can stay open for minutes.
    user_id = session.get("user_id")
    known_user = bool(user_id) and db.session.get(User, user_id) is not None
    db.session.remove()
    if not known_user:
        _fail(ws, "Please log in first.")
        return

    # --- open the connection to Meta and do the handshake ---
    try:
        meta = connect(_meta_url(), open_timeout=10, max_size=2**20)
    except Exception:
        log.exception("Could not open Meta's live transcription")
        _fail(ws, "Live transcription isn't available right now.")
        return

    try:
        meta.send(
            json.dumps(
                {
                    "authorization": {"accessToken": f"Bearer {Config.META_API_KEY}"},
                    "audioEncoding": "PCM_24KHZ",
                    "model": transcribe_model(),
                    "mode": "PUSH_TO_TALK",
                    "partialMode": "CUMULATIVE",  # each partial is the whole sentence so far
                    "emitAudioProgress": False,
                }
            )
        )
        acknowledgement = json.loads(meta.recv(timeout=10))
        if "sessionId" not in acknowledgement:
            raise RuntimeError(f"Handshake failed: {acknowledgement}")
        log.info("Live transcription started (Meta session %s)", acknowledgement["sessionId"])
    except Exception:
        log.exception("Live transcription handshake failed")
        try:
            meta.close()
        except Exception:
            pass
        _fail(ws, "Live transcription isn't available right now.")
        return

    _send(ws, {"type": "ready"})

    # --- Meta -> browser, on its own thread ---
    finished = threading.Event()

    def pump_from_meta():
        try:
            for message in meta:
                if isinstance(message, bytes):
                    continue
                event = json.loads(message)
                kind = event.get("type")
                if kind == "transcript":
                    # in PUSH_TO_TALK, final: true marks the completed transcript
                    _send(
                        ws,
                        {
                            "type": "final" if event.get("final") else "partial",
                            "text": event.get("transcript", ""),
                        },
                    )
                elif kind == "error":
                    log.error("Meta live transcription error: %s", event.get("message"))
                    _send(ws, {"type": "error", "message": "Live transcription hit a problem."})
        except Exception:
            log.debug("Meta side of the live socket closed", exc_info=True)
        finally:
            finished.set()

    threading.Thread(target=pump_from_meta, daemon=True).start()

    # --- browser -> Meta ---
    received = 0
    ended = False
    try:
        while not finished.is_set():
            data = ws.receive(timeout=1)  # None if nothing arrived in that second
            if data is None:
                continue

            if isinstance(data, (bytes, bytearray)):
                received += len(data)
                if received > MAX_SECONDS * BYTES_PER_SECOND:
                    break
                meta.send(bytes(data))
                continue

            try:
                message = json.loads(data)
            except ValueError:
                continue
            if message.get("type") == "end":
                meta.send(json.dumps({"type": "endStream"}))  # no more audio, please finish up
                ended = True
                break

        if ended:
            finished.wait(timeout=10)  # Meta sends the final transcript, then closes
    except ConnectionClosed:
        pass  # the person left or cancelled
    except Exception:
        log.exception("Live socket failed")
    finally:
        try:
            meta.close()
        except Exception:
            pass
        try:
            ws.close()
        except Exception:
            pass