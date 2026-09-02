"""Failure classification for ``execute_trade``'s one automatic rebuild.

Mirrors ``sdk-ts/src/retry.ts`` on the gateway's JSON shape. A stale
footprint / resource trap or a full RPC queue is worth ONE rebuild
(re-prepare with a fresh simulation and footprint, re-sign, resubmit); a
contract revert never is.

The gateway surfaces a failed submission three ways, all covered here:

* ``200`` + ``status: FAILED`` — applied on-chain and failed; ``hostError`` /
  ``txResultCode`` say whether a rebuild fixes it.
* ``400 submission_rejected`` — the RPC refused it at send time (never
  accepted); same facts in the body.
* ``503 try_again_later`` — the RPC queue was full (never accepted).

Any OTHER 503 (an ingress or gateway outage) is NOT retried: the gateway may
already have broadcast attempt 1, and a rebuilt copy with a fresh sequence
number could apply alongside it — two leveraged positions instead of one.
"""

from __future__ import annotations

import re
from typing import Any, Literal

TradeFailureClass = Literal["stale_footprint", "try_again_later", "none"]

_STALE_RESULT_CODES = re.compile(r"^(txSorobanInvalid|txInsufficientRefundableFee)$", re.IGNORECASE)


def classify_submit_failure(
    *,
    status: str | None = None,
    contract_error: dict[str, Any] | None = None,
    host_error: dict[str, Any] | None = None,
    tx_result_code: str | None = None,
    http_status: int | None = None,
    error_code: str | None = None,
) -> TradeFailureClass:
    if contract_error and isinstance(contract_error.get("code"), int):
        return "none"
    if http_status == 503:
        return "try_again_later" if error_code == "try_again_later" else "none"
    # Only a send-time rejection carries rebuildable facts; every other HTTP
    # failure (validation, auth, rate limit, 5xx) is not ours to retry.
    if http_status is not None and (http_status != 400 or error_code != "submission_rejected"):
        return "none"
    # PENDING may still apply — resubmitting a rebuilt copy could double-fill.
    if status is not None and status != "FAILED":
        return "none"
    if tx_result_code and _STALE_RESULT_CODES.match(tx_result_code):
        return "stale_footprint"
    if host_error and host_error.get("code") == "exceeded_limit" and host_error.get("type") in ("storage", "budget"):
        return "stale_footprint"
    return "none"
