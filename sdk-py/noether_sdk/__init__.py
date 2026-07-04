"""Official Python SDK for Noether — a decentralized perpetual exchange on Stellar / Soroban."""

from .client import NoetherClient
from .errors import (
    ApiError,
    AuthError,
    BadRequestError,
    NetworkError,
    NoetherError,
    NotFoundError,
    RateLimitError,
    ServerError,
)
from .models import (
    AccountIdentity,
    BetaStatus,
    HealthStatus,
    IssuedApiKey,
    IssuedChallenge,
    MarketSummary,
    OpenPositionRow,
    OracleSnapshot,
    PreparedTransaction,
    RawEvent,
    ReferralBindingRow,
    ReferralClaimRow,
    ReferralMeResponse,
    ReferralTradeRow,
    ReferrerRow,
    SubmittedTx,
    VaultActivityRow,
    VaultRow,
    VaultTradeRow,
)

# Single source of truth for the package version — pyproject.toml reads
# this via [tool.hatch.version].
__version__ = "0.1.2"
__all__ = [
    "NoetherClient",
    # Errors
    "NoetherError",
    "ApiError",
    "AuthError",
    "BadRequestError",
    "NotFoundError",
    "RateLimitError",
    "ServerError",
    "NetworkError",
    # Models
    "AccountIdentity",
    "BetaStatus",
    "HealthStatus",
    "IssuedApiKey",
    "IssuedChallenge",
    "MarketSummary",
    "OpenPositionRow",
    "OracleSnapshot",
    "PreparedTransaction",
    "RawEvent",
    "ReferrerRow",
    "ReferralBindingRow",
    "ReferralClaimRow",
    "ReferralMeResponse",
    "ReferralTradeRow",
    "SubmittedTx",
    "VaultActivityRow",
    "VaultRow",
    "VaultTradeRow",
]
