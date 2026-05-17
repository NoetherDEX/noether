from ..errors import NotFoundError
from ..models import VaultActivityRow, VaultRow
from ..transport import Transport


class VaultsApi:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    async def list(
        self, *, leader: str | None = None, limit: int | None = None
    ) -> list[VaultRow]:
        body = await self._transport.request(
            "GET", "/v1/vaults", params={"leader": leader, "limit": limit}
        )
        return [VaultRow.model_validate(v) for v in body.get("vaults", [])]

    async def get(self, vault_id: int) -> VaultRow | None:
        try:
            body = await self._transport.request("GET", f"/v1/vaults/{vault_id}")
        except NotFoundError:
            return None
        return VaultRow.model_validate(body)

    async def deposits(self, vault_id: int, *, limit: int | None = None) -> list[VaultActivityRow]:
        body = await self._transport.request(
            "GET", f"/v1/vaults/{vault_id}/deposits", params={"limit": limit}
        )
        return [VaultActivityRow.model_validate(r) for r in body.get("deposits", [])]

    async def withdraws(self, vault_id: int, *, limit: int | None = None) -> list[VaultActivityRow]:
        body = await self._transport.request(
            "GET", f"/v1/vaults/{vault_id}/withdraws", params={"limit": limit}
        )
        return [VaultActivityRow.model_validate(r) for r in body.get("withdraws", [])]

    async def fee_claims(
        self, vault_id: int, *, limit: int | None = None
    ) -> list[VaultActivityRow]:
        body = await self._transport.request(
            "GET", f"/v1/vaults/{vault_id}/fee-claims", params={"limit": limit}
        )
        return [VaultActivityRow.model_validate(r) for r in body.get("feeClaims", [])]
