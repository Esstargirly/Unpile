from werkzeug.security import check_password_hash, generate_password_hash

from extensions import db

DUMP_SOURCES = ("voice", "photo", "text")
TASK_STATUSES = ("queued", "active", "done", "parked")


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.BigInteger, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, nullable=False)
    password_hash = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())

    dumps = db.relationship("Dump", backref="user", cascade="all, delete-orphan", passive_deletes=True)
    tasks = db.relationship("Task", backref="user", cascade="all, delete-orphan", passive_deletes=True)

    # emails are unique no matter the casing (Esther@x.com == esther@x.com)
    __table_args__ = (db.Index("users_email_unique", db.func.lower(email), unique=True),)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        # never include password_hash here
        return {"id": self.id, "name": self.name, "email": self.email}


class Dump(db.Model):
    """One brain dump: something the user said, photographed or typed."""

    __tablename__ = "dumps"

    id = db.Column(db.BigInteger, primary_key=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source = db.Column(db.Text, nullable=False)  # voice, photo or text
    raw_text = db.Column(db.Text)  # transcript, typed text, or what Spark read from the photo
    image_ref = db.Column(db.Text)  # path of the uploaded image (photo dumps only)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())

    tasks = db.relationship("Task", backref="dump", passive_deletes=True)

    __table_args__ = (
        db.CheckConstraint(f"source IN {DUMP_SOURCES}", name="dumps_source_check"),
        db.Index("dumps_user_created_idx", "user_id", "created_at"),
    )


class Task(db.Model):
    """Something pulled out of a dump, or a thought parked mid-task."""

    __tablename__ = "tasks"

    id = db.Column(db.BigInteger, primary_key=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    dump_id = db.Column(db.BigInteger, db.ForeignKey("dumps.id", ondelete="SET NULL"))  # empty for parked thoughts

    title = db.Column(db.Text, nullable=False)  # e.g. "Pay the electricity bill"
    next_action = db.Column(db.Text)  # the one small step shown on screen
    status = db.Column(db.Text, nullable=False, default="queued", server_default="queued")

    urgency_score = db.Column(db.SmallInteger, nullable=False, default=5, server_default="5")
    urgency_reason = db.Column(db.Text)  # the short "why this first" line
    estimate_minutes = db.Column(db.SmallInteger)  # Spark's guess for "Takes 3 minutes"
    due_at = db.Column(db.DateTime(timezone=True))
    depends_on = db.Column(db.BigInteger, db.ForeignKey("tasks.id", ondelete="SET NULL"))  # must be done first

    position = db.Column(db.Integer, nullable=False, default=0, server_default="0")  # lower = sooner

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())
    completed_at = db.Column(db.DateTime(timezone=True))
    parked_at = db.Column(db.DateTime(timezone=True))

    __table_args__ = (
        db.CheckConstraint(f"status IN {TASK_STATUSES}", name="tasks_status_check"),
        db.CheckConstraint("urgency_score BETWEEN 0 AND 10", name="tasks_urgency_check"),
        db.Index("tasks_user_status_position_idx", "user_id", "status", "position"),
        # a user can only have ONE active task at a time. This is the whole app idea,
        # so the database enforces it instead of trusting the code.
        db.Index(
            "tasks_one_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=db.text("status = 'active'"),
        ),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "next_action": self.next_action,
            "status": self.status,
            "urgency_reason": self.urgency_reason,
            "minutes": self.estimate_minutes,
            "due_at": self.due_at.isoformat() if self.due_at else None,
        }