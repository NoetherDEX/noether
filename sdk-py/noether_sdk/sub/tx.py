from ..errors import AuthError
from ..models import SubmittedTx
from ..transport import Credentials, Transport


class TxApi:
    def __init__(self, transport: Transport, credentials: Credentials | None) -> None:
        self._transport = transport
        self._credentials = credentials

    async def submit(self, *, signed_xdr: str, poll_timeout_ms: int | None = None) -> SubmittedTx:
        if self._credentials is None:
            raise AuthError(
                "tx.submit requires an authenticated client",
                status=401,
                body=None,
                url="/v1/tx/submit",
            )
        payload: dict[str, object] = {"signedXdr": signed_xdr}
        if poll_timeout_ms is not None:
            payload["pollTimeoutMs"] = poll_timeout_ms
        body = await self._transport.request(
            "POST",
            "/v1/tx/submit",
            json=payload,
            credentials=self._credentials,
        )
        return SubmittedTx.model_validate(body)
