"""Per-resource sub-clients."""

from .account import AccountApi
from .events import EventsApi
from .health import HealthApi
from .keys import KeysApi
from .markets import MarketsApi
from .oracle import OracleApi
from .orders import OrdersApi
from .referral import ReferralApi
from .tx import TxApi
from .vaults import VaultsApi

__all__ = [
    "AccountApi",
    "EventsApi",
    "HealthApi",
    "KeysApi",
    "MarketsApi",
    "OracleApi",
    "OrdersApi",
    "ReferralApi",
    "TxApi",
    "VaultsApi",
]
