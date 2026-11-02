import os

from dotenv import load_dotenv

load_dotenv()


def _require(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}. Check your .env file.")
    return value


def _fix_db_url(url):
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Config:
    # --- core ---
    SECRET_KEY = _require("SECRET_KEY")

    # --- database (Neon connection string) ---
    SQLALCHEMY_DATABASE_URI = _fix_db_url(_require("DATABASE_URL"))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 300}

    # --- sessions / cookies ---
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    
    SESSION_COOKIE_SECURE = bool(os.getenv("RENDER"))

    # --- Meta Model API ---
    META_API_KEY = _require("META_API_KEY")
    META_API_BASE_URL = _require("META_API_BASE_URL")

    META_SPARK_MODEL = os.getenv("META_SPARK_MODEL", "")
    META_TRANSCRIBE_MODEL = os.getenv("META_TRANSCRIBE_MODEL", "")

    # --- uploads (photos / audio) ---
    UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
    MAX_CONTENT_LENGTH = 32 * 1024 * 1024 