import os

from flask import Flask, jsonify
from sqlalchemy import text

from config import Config
from extensions import db


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # folder for uploaded photos and audio
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    db.init_app(app)

    # importing the models is what tells SQLAlchemy which tables exist
    import models  # noqa: F401

    with app.app_context():
        db.create_all()

    # blueprints (auth, dump, focus, park) get registered here as we build them

    @app.get("/health")
    def health():
        # quick check that the app can reach Neon
        try:
            db.session.execute(text("SELECT 1"))
            return jsonify(status="ok")
        except Exception:
            app.logger.exception("Database check failed")
            return jsonify(status="error", detail="cannot reach the database"), 500

    return app


# module-level app so "gunicorn app:app" works when we deploy
app = create_app()

if __name__ == "__main__":
    app.run(debug=True)