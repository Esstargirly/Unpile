from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from extensions import db
from models import Task
from routes.auth import login_required
from services.planner import activate_next_task

focus_bp = Blueprint("focus", __name__, url_prefix="/api")


def _count(user_id, status):
    return db.session.scalar(
        db.select(func.count(Task.id)).where(Task.user_id == user_id, Task.status == status)
    )


def _state(user_id, **extra):
    """What the focus screen needs: the ONE task, and yes/no flags. Never counts."""
    active = db.session.scalar(db.select(Task).where(Task.user_id == user_id, Task.status == "active"))
    waiting = _count(user_id, "queued")
    finished_something = _count(user_id, "done") > 0
    return {
        "active": active.to_dict() if active else None,
        "has_more": waiting > 0,
        # nothing left AND they got through some tasks: show the "pile is gone" screen
        "all_clear": active is None and waiting == 0 and finished_something,
        **extra,
    }


def _lock_active(user_id):
    """The user's active task, locked so two quick taps can't both act on it."""
    return db.session.scalar(
        db.select(Task).where(Task.user_id == user_id, Task.status == "active").with_for_update()
    )


def _is_stale(current):
    """The screen sends the id of the task it is showing. If that isn't the active task any more
    (a double tap, or a second tab), we do nothing and just send back the real current state."""
    data = request.get_json(silent=True) or {}
    if "task_id" not in data:
        return False
    try:
        return int(data["task_id"]) != current.id
    except (TypeError, ValueError):
        return True


@focus_bp.get("/focus")
@login_required
def get_focus():
    # if nothing is active but something is waiting, this picks the next one
    activate_next_task(g.user.id)
    db.session.commit()
    return jsonify(_state(g.user.id))


@focus_bp.post("/focus/done")
@login_required
def done():
    current = _lock_active(g.user.id)
    if current is None or _is_stale(current):
        return jsonify(_state(g.user.id))

    current.status = "done"
    current.completed_at = datetime.now(timezone.utc)
    db.session.flush()  # the old task has to stop being active before the next one starts

    activate_next_task(g.user.id)
    db.session.commit()
    return jsonify(_state(g.user.id))


@focus_bp.post("/focus/not-now")
@login_required
def not_now():
    """Moves the current task back a place and shows the next one instead."""
    current = _lock_active(g.user.id)
    if current is None or _is_stale(current):
        return jsonify(_state(g.user.id))

    open_tasks = db.session.scalars(
        db.select(Task)
        .where(Task.user_id == g.user.id, Task.status.in_(("queued", "active")))
        .order_by(Task.position)
    ).all()
    done_ids = set(
        db.session.scalars(db.select(Task.id).where(Task.user_id == g.user.id, Task.status == "done"))
    )

    # put it right AFTER the next task that can actually be started
    others = [t for t in open_tasks if t.id != current.id]
    insert_at = len(others)
    for index, task in enumerate(others):
        if task.depends_on is None or task.depends_on in done_ids:
            insert_at = index + 1
            break
    others.insert(insert_at, current)
    for index, task in enumerate(others):
        task.position = index

    current.status = "queued"
    db.session.flush()

    next_task = activate_next_task(g.user.id)
    db.session.commit()

    # if it's the only startable thing, it comes straight back, and the screen can say so
    only_one = next_task is not None and next_task.id == current.id
    return jsonify(_state(g.user.id, only_one=only_one))