import os

from flask import Flask, jsonify
from sqlalchemy import text

from config import Config
from extensions import db, sock


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    db.init_app(app)
    sock.init_app(app)

    import models 

    with app.app_context():
        db.create_all()
       
        if db.engine.dialect.name == "postgresql":
            db.session.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_minutes SMALLINT"))
            db.session.commit()

    from routes.auth import auth_bp
    from routes.dump import dump_bp
    from routes.focus import focus_bp
    import routes.live  
    from routes.pages import pages_bp
    from routes.park import park_bp

    app.register_blueprint(pages_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(dump_bp)
    app.register_blueprint(focus_bp)
    app.register_blueprint(park_bp)

    @app.errorhandler(413)
    def too_big(_error):
        return jsonify(error="That file is too big. Try a shorter recording."), 413

    @app.get("/ping")
    def ping():
        return "ok", 200, {"Cache-Control": "no-store", "Content-Type": "text/plain"}

    @app.get("/health")
    def health():
        try:
            db.session.execute(text("SELECT 1"))
            return jsonify(status="ok")
        except Exception:
            app.logger.exception("Database check failed")
            return jsonify(status="error", detail="cannot reach the database"), 500

    return app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)