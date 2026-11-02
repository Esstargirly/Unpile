from flask_sock import Sock
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
sock = Sock()  # WebSockets, used for live transcription