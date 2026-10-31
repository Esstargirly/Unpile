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

    from routes.auth import auth_bp
    from routes.dump import dump_bp
    from routes.focus import focus_bp
    from routes.park import park_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dump_bp)
    app.register_blueprint(focus_bp)
    app.register_blueprint(park_bp)

    @app.errorhandler(413)
    def too_big(_error):
        return jsonify(error="That file is too big. Try a shorter recording."), 413

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