"""Typed thin client for the game-factory HTTP API (`bin/factory serve`). Standard library only."""
from .client import (  # noqa: F401
    API_VERSION,
    DEFAULT_BASE_URL,
    Client,
    Envelope,
    Event,
    FactoryError,
    codes,
)
