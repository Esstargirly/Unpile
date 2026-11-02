from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from extensions import db
from models import Task
from routes.auth import login_required
from services.planner import PlannerError, activate_next_task, extract_tasks
from services.transcribe import TranscribeError, transcribe_wav

park_bp = Blueprint("park", __name__, url_prefix="/api")

MAX_THOUGHT_CHARS = 300


def _parked_dict(task):
    return {
        "id": task.id,
        "title": task.title,
        "parked_at": task.parked_at.isoformat() if task.parked_at else None,
    }


def _get_parked_or_none(task_id):
    """Only this user's own parked thoughts. Anyone else's id looks like it doesn't exist."""
    return db.session.scalar(
        db.select(Task).where(Task.id == task_id, Task.user_id == g.user.id, Task.status == "parked")
    )


@park_bp.post("/park")
@login_required
def park_thought():
    """Saves a thought that popped up mid-task, so the person can let it go for now.

    Same two ways in as /api/dump: an "audio" WAV part, or JSON like {"text": "..."}.
    """
    audio = request.files.get("audio")
    try:
        if audio:
            text = transcribe_wav(audio.read())
        else:
            data = request.get_json(silent=True) or {}
            text = data.get("text")
            text = text if isinstance(text, str) else ""
    except TranscribeError as error:
        return jsonify(error=str(error)), 400

    text = " ".join(text.split())[:MAX_THOUGHT_CHARS]  # tidy whitespace, keep it short
    if not text:
        return jsonify(error="Say or type the thought first."), 400

    task = Task(
        user_id=g.user.id,
        title=text,
        status="parked",
        parked_at=datetime.now(timezone.utc),
        position=0,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(parked=_parked_dict(task)), 201


@park_bp.get("/parked")
@login_required
def list_parked():
    tasks = db.session.scalars(
        db.select(Task)
        .where(Task.user_id == g.user.id, Task.status == "parked")
        .order_by(Task.parked_at.desc(), Task.id.desc())
    ).all()
    return jsonify(parked=[_parked_dict(t) for t in tasks])


@park_bp.post("/parked/<int:task_id>/bring-back")
@login_required
def bring_back(task_id):
    """Moves a parked thought into the queue, right after the task they're on now."""
    task = _get_parked_or_none(task_id)
    if task is None:
        return jsonify(error="That thought isn't on your shelf anymore."), 404

    # Spark gives it a proper first step, like any other task. If Spark is down or the
    # thought is really several tasks, we just keep it as it is.
    try:
        found = extract_tasks(task.title)
    except PlannerError:
        found = []
    if len(found) == 1:
        item = found[0]
        task.title = item["title"]
        task.next_action = item["next_action"] or None
        task.urgency_score = item["urgency_score"]
        task.urgency_reason = item["urgency_reason"] or None
        task.estimate_minutes = item["minutes"]
        task.due_at = item["due_at"]

    open_tasks = db.session.scalars(
        db.select(Task)
        .where(Task.user_id == g.user.id, Task.status.in_(("queued", "active")))
        .order_by(Task.position)
    ).all()
    active_index = next((i for i, t in enumerate(open_tasks) if t.status == "active"), -1)
    open_tasks.insert(active_index + 1, task)  # next in line, without interrupting the current task

    task.status = "queued"
    task.parked_at = None
    for index, t in enumerate(open_tasks):
        t.position = index
    db.session.flush()

    activate_next_task(g.user.id)  # only does anything if nothing was active
    db.session.commit()
    # active_now = it became the thing to focus on straight away (nothing else was active)
    return jsonify(ok=True, active_now=task.status == "active")


@park_bp.delete("/parked/<int:task_id>")
@login_required
def let_go(task_id):
    """Lets a parked thought go for good."""
    task = _get_parked_or_none(task_id)
    if task is None:
        return jsonify(error="That thought isn't on your shelf anymore."), 404
    db.session.delete(task)
    db.session.commit()
    return jsonify(ok=True)


@park_bp.post("/transcribe")
@login_required
def transcribe_only():
    """Turns a recording into text and nothing else. Used by the Park a thought sheet,
    so a spoken thought can land in the box and be edited before it's parked."""
    audio = request.files.get("audio")
    if not audio:
        return jsonify(error="Say something first."), 400
    try:
        text = transcribe_wav(audio.read())
    except TranscribeError as error:
        return jsonify(error=str(error)), 400
    return jsonify(text=text)