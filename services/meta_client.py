from openai import OpenAI

from config import Config

_client = None


def get_client():
    """Returns one shared client, pointed at Meta's OpenAI-compatible endpoint."""
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=Config.META_API_BASE_URL,
            api_key=Config.META_API_KEY,  # the SDK won't find this on its own, so we pass it in
            timeout=60,
            max_retries=2,
        )
    return _client


def spark_model():
    if not Config.META_SPARK_MODEL:
        raise RuntimeError("META_SPARK_MODEL is empty. Set it in your .env (muse-spark-1.3).")
    return Config.META_SPARK_MODEL


def transcribe_model():
    if not Config.META_TRANSCRIBE_MODEL:
        raise RuntimeError("META_TRANSCRIBE_MODEL is empty. Set it in your .env.")
    return Config.META_TRANSCRIBE_MODEL


if __name__ == "__main__":
    # tiny smoke test: proves the key, base URL and model ID all work together
    response = get_client().responses.create(
        model=spark_model(),
        input="Reply with the single word: ready",
    )
    print("Spark says:", response.output_text)