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
    HealthStatus,
    IssuedApiKey,
    IssuedChallenge,
    MarketSummary,
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
)

__version__ = "0.0.0"
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
    "HealthStatus",
    "IssuedApiKey",
    "IssuedChallenge",
    "MarketSummary",
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
]
