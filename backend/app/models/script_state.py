from enum import Enum


class ScriptState(str, Enum):
    """
    Script analysis state lifecycle.

    - EMPTY: New script, minimal content, no analysis
    - PARTIAL: Some scenes exist, lightweight artifacts generated
    - ANALYZED: Full draft with comprehensive artifacts
    """
    EMPTY = "empty"
    PARTIAL = "partial"
    ANALYZED = "analyzed"
