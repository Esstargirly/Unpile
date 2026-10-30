from flask_sqlalchemy import SQLAlchemy

# created here, attached to the app in app.py
# (kept in its own file so models and routes can import it without circular imports)
db = SQLAlchemy()