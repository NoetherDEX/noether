from noether_sdk.errors import (
    AuthError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
    RegionRestrictedError,
    ServerError,
    ServiceUnavailableError,
    classify_error,
)


def test_classifies_4xx() -> None:
    assert isinstance(classify_error(400, {"error": "bad"}, "/x", None), BadRequestError)
    assert isinstance(classify_error(401, {"error": "auth"}, "/x", None), AuthError)
    assert isinstance(classify_error(403, {"error": "auth"}, "/x", None), AuthError)
    assert isinstance(classify_error(404, {"error": "missing"}, "/x", None), NotFoundError)


def test_401_is_not_forbidden() -> None:
    err = classify_error(401, {"error": "invalid_credentials"}, "/x", None)
    assert isinstance(err, AuthError)
    assert not isinstance(err, ForbiddenError)
    assert err.code == "invalid_credentials"


def test_403_not_in_beta_is_forbidden_and_distinguishable() -> None:
    err = classify_error(403, {"error": "not_in_beta"}, "/x", None)
    assert isinstance(err, ForbiddenError)
    # Still an AuthError so pre existing handlers keep working.
    assert isinstance(err, AuthError)
    assert err.status == 403
    assert err.code == "not_in_beta"


def test_409_key_limit_reached_is_conflict() -> None:
    err = classify_error(409, {"error": "key_limit_reached"}, "/x", None)
    assert isinstance(err, ConflictError)
    assert not isinstance(err, BadRequestError)
    assert err.code == "key_limit_reached"


def test_451_region_restricted() -> None:
    err = classify_error(451, {"error": "region_restricted"}, "/x", None)
    assert isinstance(err, RegionRestrictedError)
    assert not isinstance(err, BadRequestError)
    assert err.code == "region_restricted"


def test_classifies_429_with_retry_after() -> None:
    err = classify_error(429, {"error": "rate_limited"}, "/x", 12)
    assert isinstance(err, RateLimitError)
    assert err.retry_after_sec == 12


def test_classifies_5xx() -> None:
    assert isinstance(classify_error(500, {"error": "boom"}, "/x", None), ServerError)
    assert isinstance(classify_error(503, None, "/x", None), ServerError)


def test_503_try_again_later_carries_retry_after() -> None:
    err = classify_error(503, {"error": "try_again_later", "retryable": True}, "/x", 2)
    assert isinstance(err, ServiceUnavailableError)
    # Still a ServerError so pre existing handlers keep working.
    assert isinstance(err, ServerError)
    assert err.retry_after_sec == 2
    assert err.code == "try_again_later"


def test_code_is_none_without_an_error_string() -> None:
    assert classify_error(400, {"message": "nope"}, "/x", None).code is None
    assert classify_error(500, None, "/x", None).code is None


def test_message_falls_back_to_status_when_body_missing() -> None:
    err = classify_error(418, None, "/x", None)
    assert "418" in str(err)
