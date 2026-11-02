from datetime import datetime, timedelta, timezone

from flask import Blueprint, redirect, render_template, session, url_for
from sqlalchemy import func

from extensions import db
from models import Task, User
from routes.focus import focus_state
from services.planner import activate_next_task

# The web pages people actually see. (The /api/... routes are for the pages to talk to.)
pages_bp = Blueprint("pages", __name__)


def _logged_in_user():
    user_id = session.get("user_id")
    user = db.session.get(User, user_id) if user_id else None
    if user_id and user is None:
        session.clear()  # the account no longer exists
    return user


def _first_name(user):
    parts = user.name.split()
    return parts[0] if parts else user.name


def _count(user_id, *conditions):
    return db.session.scalar(db.select(func.count(Task.id)).where(Task.user_id == user_id, *conditions))


@pages_bp.after_request
def no_cache(response):
    # so the back button after logging out can't show someone's old page
    response.headers["Cache-Control"] = "no-store"
    return response


@pages_bp.get("/")
def home():
    user = _logged_in_user()
    if user is None:
        return redirect(url_for("pages.login"))

    # the two "quiet insights" on the home screen are real numbers
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    cleared = _count(user.id, Task.status == "done", Task.completed_at >= since)
    parked = _count(user.id, Task.status == "parked")

    return render_template(
        "home.html", user=user, first_name=_first_name(user), cleared=cleared, parked=parked
    )


@pages_bp.get("/focus")
def focus():
    user = _logged_in_user()
    if user is None:
        return redirect(url_for("pages.login"))

    # if nothing is active but something is waiting, this picks the next one
    activate_next_task(user.id)
    db.session.commit()
    # the page starts with the real task already in it, so there's no empty flash
    return render_template(
        "focus.html", user=user, first_name=_first_name(user), state=focus_state(user.id)
    )


@pages_bp.get("/parked")
def parked():
    user = _logged_in_user()
    if user is None:
        return redirect(url_for("pages.login"))

    tasks = db.session.scalars(
        db.select(Task)
        .where(Task.user_id == user.id, Task.status == "parked")
        .order_by(Task.parked_at.desc(), Task.id.desc())
    ).all()
    items = [
        {"id": t.id, "title": t.title, "parked_at": t.parked_at.isoformat() if t.parked_at else None}
        for t in tasks
    ]
    return render_template("parked.html", user=user, first_name=_first_name(user), items=items)


@pages_bp.get("/profile")
def profile():
    user = _logged_in_user()
    if user is None:
        return redirect(url_for("pages.login"))
    return render_template("profile.html", user=user, first_name=_first_name(user))


@pages_bp.get("/login")
def login():
    if _logged_in_user():
        return redirect(url_for("pages.home"))
    return render_template("login.html")


@pages_bp.get("/signup")
def signup():
    if _logged_in_user():
        return redirect(url_for("pages.home"))
    return render_template("signup.html")