import re
from functools import wraps

from flask import Blueprint, g, jsonify, request, session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import User

auth_bp = Blueprint("auth", __name__, url_prefix="/api")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128  # stops someone sending a giant string to be hashed


def login_required(view):
    """Put this on any route that needs a logged-in user.
    Inside the route, the user is available as g.user."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        user_id = session.get("user_id")
        user = db.session.get(User, user_id) if user_id else None
        if user is None:
            session.clear()
            return jsonify(error="Please log in first."), 401
        g.user = user
        return view(*args, **kwargs)

    return wrapper


def _start_session(user):
    session.clear()
    session["user_id"] = user.id
    session.permanent = True  # stays logged in between visits


def _find_user_by_email(email):
    return db.session.scalar(db.select(User).where(func.lower(User.email) == email))


@auth_bp.post("/signup")
def signup():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name:
        return jsonify(error="Please enter your name."), 400
    if not EMAIL_RE.match(email):
        return jsonify(error="Please enter a valid email."), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify(error=f"Password must be at least {MIN_PASSWORD_LENGTH} characters."), 400
    if len(password) > MAX_PASSWORD_LENGTH:
        return jsonify(error="That password is too long."), 400

    if _find_user_by_email(email):
        return jsonify(error="An account with that email already exists."), 409

    user = User(name=name, email=email)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        # two signups with the same email at the same moment
        db.session.rollback()
        return jsonify(error="An account with that email already exists."), 409

    _start_session(user)
    return jsonify(user=user.to_dict()), 201


@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = _find_user_by_email(email)
    # same message for "no such email" and "wrong password" on purpose
    if user is None or not user.check_password(password):
        return jsonify(error="Wrong email or password."), 401

    _start_session(user)
    return jsonify(user=user.to_dict())


@auth_bp.post("/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@auth_bp.get("/me")
@login_required
def me():
    return jsonify(user=g.user.to_dict())