"""Frozen v2.6 inference compatibility layer.

v2.6 changed only the training opponent ecosystem. Its 5,974-dimensional
observation and 54-action inference semantics are identical to frozen v2.4,
so the existing immutable snapshot is the single compatibility source.
"""

try:
    from .env_v24 import *  # noqa: F401,F403
except ImportError:
    from env_v24 import *  # noqa: F401,F403
