"""execute_trade's one automatic rebuild — parity with the TS SDK's executeTrade.

Scripted httpx.MockTransport, no network. Covers the three gateway shapes a
rebuild is worth (200 FAILED with a host trap or a stale result code, 400
submission_rejected, 503 try_again_later), the shapes it must never retry
(contract revert, PENDING, a generic 503), and the opt-out.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from noether_sdk import NoetherClient
from noether_sdk.errors import ServiceUnavailableError
from noether_sdk.retry import classify_submit_failure
from noether_sdk.transport import Credentials


class Recorder:
    """Scripted responses, FIFO; records every request for assertions."""

    def __init__(self, *responses: tuple[int, Any] | tuple[int, Any, dict[str, str]]) -> None:
        self.requests: list[httpx.Request] = []
        self._responses = list(responses)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert self._responses, f"no scripted response left for {request.url}"
        script = self._responses.pop(0)
        headers = script[2] if len(script) > 2 else {}
        return httpx.Response(script[0], json=script[1], headers=headers)


def make_client(recorder: Recorder, credentials: Credentials | None = None) -> NoetherClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    return NoetherClient("http://api.test", credentials=credentials, client=http)


CREDS = Credentials(key_id="nk_x", secret="shh")
PREPARED = {"op": "close_position", "trader": "GABC", "xdr": "AAAA", "minResourceFee": "100"}
REQUEST = {"action": "close_position", "trader": "GABC", "positionId": 1}
SUCCESS = {"hash": "h2", "status": "SUCCESS", "contractError": None, "hostError": None}
STALE = {"hash": "h1", "status": "FAILED", "contractError": None, "hostError": {"type": "storage", "code": "exceeded_limit"}}


def _client(*responses) -> tuple[NoetherClient, Recorder]:
    rec = Recorder(*responses)
    return make_client(rec, CREDS), rec


async def test_rebuilds_once_on_a_stale_footprint_trap() -> None:
    client, rec = _client((200, PREPARED), (200, STALE), (200, {**PREPARED, "xdr": "BBBB"}), (200, SUCCESS))
    signed: list[str] = []

    def signer(xdr: str) -> str:
        signed.append(xdr)
        return f"signed:{xdr}"

    prepared, submitted = await client.execute_trade(REQUEST, signer)
    assert submitted.status == "SUCCESS"
    assert prepared.xdr == "BBBB"
    assert signed == ["AAAA", "BBBB"]  # fresh bytes on the retry
    assert [r.url.path for r in rec.requests] == [
        "/v1/orders/prepare", "/v1/tx/submit", "/v1/orders/prepare", "/v1/tx/submit",
    ]


async def test_rebuilds_on_a_stale_result_code_and_a_send_time_rejection() -> None:
    invalid = {**STALE, "hostError": None, "txResultCode": "txSorobanInvalid"}
    client, rec = _client((200, PREPARED), (200, invalid), (200, PREPARED), (200, SUCCESS))
    _, submitted = await client.execute_trade(REQUEST, lambda x: x)
    assert submitted.status == "SUCCESS"
    assert len(rec.requests) == 4

    rejected = {"error": "submission_rejected", "message": "Submission rejected by RPC", "contractError": None,
                "hostError": {"type": "budget", "code": "exceeded_limit"}}
    client, rec = _client((200, PREPARED), (400, rejected), (200, PREPARED), (200, SUCCESS))
    _, submitted = await client.execute_trade(REQUEST, lambda x: x)
    assert submitted.status == "SUCCESS"
    assert len(rec.requests) == 4


async def test_retries_the_rpc_queue_signal_but_never_a_generic_503() -> None:
    client, rec = _client(
        (200, PREPARED),
        (503, {"error": "try_again_later", "retryable": True, "hash": "h1"}, {"retry-after": "2"}),
        (200, PREPARED),
        (200, SUCCESS),
    )
    _, submitted = await client.execute_trade(REQUEST, lambda x: x, retry_delay_s=0)
    assert submitted.hash == "h2"
    assert len(rec.requests) == 4

    # An ingress 503 may arrive after the gateway broadcast attempt 1; a
    # rebuilt copy could double-open, so it surfaces as the error it is.
    client, rec = _client((200, PREPARED), (503, {"error": "upstream_unavailable"}))
    with pytest.raises(ServiceUnavailableError):
        await client.execute_trade(REQUEST, lambda x: x, retry_delay_s=0)
    assert len(rec.requests) == 2


async def test_never_retries_a_contract_revert_and_honours_the_opt_out() -> None:
    revert = {"hash": "h1", "status": "FAILED", "contractError": {"code": 30, "name": "PriceStale"}, "hostError": None}
    client, rec = _client((200, PREPARED), (200, revert))
    _, submitted = await client.execute_trade(REQUEST, lambda x: x)
    assert submitted.status == "FAILED"
    assert len(rec.requests) == 2

    client, rec = _client((200, PREPARED), (200, STALE))
    _, submitted = await client.execute_trade(REQUEST, lambda x: x, retry_on_stale_footprint=False)
    assert submitted.status == "FAILED"
    assert len(rec.requests) == 2


def test_classifier_mirrors_the_ts_sdk() -> None:
    assert classify_submit_failure(status="FAILED", host_error={"type": "budget", "code": "exceeded_limit"}) == "stale_footprint"
    assert classify_submit_failure(status="FAILED", tx_result_code="txInsufficientRefundableFee") == "stale_footprint"
    assert classify_submit_failure(status="FAILED", tx_result_code="txFailed") == "none"
    assert classify_submit_failure(status="FAILED", contract_error={"code": 63}, host_error={"type": "storage", "code": "exceeded_limit"}) == "none"
    assert classify_submit_failure(status="PENDING", host_error={"type": "storage", "code": "exceeded_limit"}) == "none"
    assert classify_submit_failure(http_status=400, error_code="submission_rejected", tx_result_code="txSorobanInvalid") == "stale_footprint"
    assert classify_submit_failure(http_status=400, error_code="validation", tx_result_code="txSorobanInvalid") == "none"
    assert classify_submit_failure(http_status=503, error_code="try_again_later") == "try_again_later"
    assert classify_submit_failure(http_status=503) == "none"
    assert classify_submit_failure(http_status=502, error_code="rpc_error") == "none"
