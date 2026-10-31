from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from extensions import db
from models import Task
from routes.auth import login_required
from services.planner import PlannerError, plan_dump
from services.transcribe import TranscribeError, transcribe_wav

dump_bp = Blueprint("dump", __name__, url_prefix="/api")


@dump_bp.post("/dump")
@login_required
def create_dump():
    """Takes a brain dump and answers with the ONE task to show first.

    Two ways to call it:
      - a recording: multipart/form-data with an "audio" part (WAV, mono, 16-bit, 16 or 24 kHz)
      - typed text:  JSON like {"text": "..."}
    (photos get added later)
    """
    audio = request.files.get("audio")

    try:
        if audio:
            source = "voice"
            # the recording is only used to get the text. We never store the audio itself.
            text = transcribe_wav(audio.read())
        else:
            source = "text"
            data = request.get_json(silent=True) or {}
            text = data.get("text")
            text = text.strip() if isinstance(text, str) else ""
            if not text:
                return jsonify(error="Say or type what's on your mind first."), 400

        result = plan_dump(g.user, source, text)
    except (TranscribeError, PlannerError) as error:
        return jsonify(error=str(error)), 400

    active = result["active"]
    if not result["tasks"]:
        return jsonify(
            transcript=text,
            found=False,
            message="I didn't find anything to do in that. Want to try again?",
            active=None,
            has_more=False,
        )

    waiting = db.session.scalar(
        db.select(func.count(Task.id)).where(Task.user_id == g.user.id, Task.status == "queued")
    )
    return jsonify(
        transcript=text,  # so the screen can show what was heard
        found=True,
        active=active.to_dict() if active else None,
        has_more=waiting > 0,  # a yes/no only, the app never shows counts
    )