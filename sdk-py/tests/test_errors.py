from noether_sdk.errors import (
    AuthError,
    BadRequestError,
    NotFoundError,
    RateLimitError,
    ServerError,
    classify_error,
)


def test_classifies_4xx() -> None:
    assert isinstance(classify_error(400, {"error": "bad"}, "/x", None), BadRequestError)
    assert isinstance(classify_error(401, {"error": "auth"}, "/x", None), AuthError)
    assert isinstance(classify_error(403, {"error": "auth"}, "/x", None), AuthError)
    assert isinstance(classify_error(404, {"error": "missing"}, "/x", None), NotFoundError)


def test_classifies_429_with_retry_after() -> None:
    err = classify_error(429, {"error": "rate_limited"}, "/x", 12)
    assert isinstance(err, RateLimitError)
    assert err.retry_after_sec == 12


def test_classifies_5xx() -> None:
    assert isinstance(classify_error(500, {"error": "boom"}, "/x", None), ServerError)
    assert isinstance(classify_error(503, None, "/x", None), ServerError)


def test_message_falls_back_to_status_when_body_missing() -> None:
    err = classify_error(418, None, "/x", None)
    assert "418" in str(err)
