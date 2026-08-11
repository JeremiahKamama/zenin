"""Shared PostHog client for standalone Zenin Python processes."""

import atexit
import logging
import os
from typing import Optional

from posthog import Posthog

logger = logging.getLogger(__name__)


def _initialize_posthog() -> Optional[Posthog]:
    """Create one optional PostHog client for the current Python process."""
    project_token = os.getenv("POSTHOG_PROJECT_TOKEN")
    host = os.getenv("POSTHOG_HOST")

    if not project_token:
        if os.getenv("NODE_ENV") != "production":
            logger.warning(
                "POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or "
                "un-configured, this causes events to be silently missed. This error "
                "stops appearing once POSTHOG_PROJECT_TOKEN is configured"
            )
        return None

    if not host:
        if os.getenv("NODE_ENV") != "production":
            logger.warning(
                "POSTHOG_HOST variable required by PostHog is missing or un-configured, "
                "this causes events to be silently missed. This error stops appearing "
                "once POSTHOG_HOST is configured"
            )
        return None

    client = Posthog(
        project_token,
        host=host,
        enable_exception_autocapture=True,
    )
    atexit.register(client.shutdown)
    return client


posthog_client = _initialize_posthog()
