"""
Yjs-to-Slate Converter Service

Provides bidirectional conversion between Yjs CRDT representation (Y.Array)
and Slate JSON format (content_blocks) for screenplay editing.

Architecture: Yjs-Primary Persistence
- Yjs Y.Array is the source of truth
- Slate JSON (content_blocks) is derived snapshot format
- Supports lossless round-trip conversion
"""

import hashlib
import json
from typing import Dict, Any, List
from y_py import YDoc

from app.services.fdx_parser import ScreenplayBlockType


class YjsToSlateConverter:
    """
    Bidirectional converter between Yjs CRDT and Slate JSON formats.

    Yjs Structure:
        YDoc.getArray('content') contains screenplay elements
        Each element is a YMap with: { type, text, metadata }

    Slate Structure:
        content_blocks: {
            "blocks": [
                {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
                {"type": "action", "text": "John enters."},
                {"type": "dialogue", "text": "Hello.", "character": "JOHN"}
            ]
        }
    """

    # Yjs shared type key used by frontend
    CONTENT_KEY = 'content'

    # Valid screenplay block types
    VALID_BLOCK_TYPES = {
        ScreenplayBlockType.SCENE_HEADING.value,
        ScreenplayBlockType.ACTION.value,
        ScreenplayBlockType.CHARACTER.value,
        ScreenplayBlockType.PARENTHETICAL.value,
        ScreenplayBlockType.DIALOGUE.value,
        ScreenplayBlockType.TRANSITION.value,
        ScreenplayBlockType.SHOT.value,
        ScreenplayBlockType.GENERAL.value,
        ScreenplayBlockType.CAST_LIST.value,
        ScreenplayBlockType.NEW_ACT.value,
        ScreenplayBlockType.END_OF_ACT.value,
        ScreenplayBlockType.SUMMARY.value,
    }

    def convert_to_slate(self, ydoc: YDoc) -> Dict[str, Any]:
        """
        Extract Slate JSON from Y.Doc.

        Args:
            ydoc: Yjs document containing screenplay content

        Returns:
            Slate JSON format: {"blocks": [...]}

        Raises:
            ValueError: If Yjs structure is invalid
        """
        # Get the shared Y.Array
        content_array = ydoc.get_array(self.CONTENT_KEY)

        blocks: List[Dict[str, Any]] = []

        # Traverse Y.Array - y-py automatically converts elements to dicts
        for i in range(len(content_array)):
            yjs_element = content_array[i]

            # y-py elements are returned as dicts
            if not isinstance(yjs_element, dict):
                raise ValueError(
                    f"Invalid Yjs element at index {i}: expected dict, "
                    f"got {type(yjs_element)}"
                )

            # Validate block structure
            if 'type' not in yjs_element or 'text' not in yjs_element:
                raise ValueError(
                    f"Invalid block at index {i}: missing 'type' or 'text' field"
                )

            # Copy to avoid mutation
            blocks.append(yjs_element.copy())

        return {"blocks": blocks}

    def populate_from_slate(
        self,
        ydoc: YDoc,
        slate_json: Dict[str, Any]
    ) -> None:
        """
        Populate Y.Doc from Slate JSON.

        Args:
            ydoc: Target Yjs document (will be cleared and repopulated)
            slate_json: Slate JSON format: {"blocks": [...]}

        Raises:
            ValueError: If slate_json structure is invalid
        """
        if not isinstance(slate_json, dict):
            raise ValueError(f"Expected dict, got {type(slate_json)}")

        if 'blocks' not in slate_json:
            raise ValueError("Slate JSON must have 'blocks' key")

        blocks = slate_json['blocks']
        if not isinstance(blocks, list):
            raise ValueError(f"'blocks' must be a list, got {type(blocks)}")

        # Get or create the shared Y.Array
        content_array = ydoc.get_array(self.CONTENT_KEY)

        # Begin transaction for mutations
        txn = ydoc.begin_transaction()
        try:
            # Clear existing content
            if len(content_array) > 0:
                content_array.delete_range(txn, 0, len(content_array))

            # Populate with Slate blocks
            for i, block in enumerate(blocks):
                if not isinstance(block, dict):
                    raise ValueError(
                        f"Block at index {i} must be a dict, got {type(block)}"
                    )

                # Validate required fields
                if 'type' not in block:
                    raise ValueError(f"Block at index {i} missing 'type' field")
                if 'text' not in block:
                    raise ValueError(f"Block at index {i} missing 'text' field")

                # Validate block type (allow unknown types for flexibility)
                # In production, could log warning for unknown types
                # block_type = block['type']
                # if block_type not in self.VALID_BLOCK_TYPES:
                #     logger.warning(f"Unknown block type: {block_type}")

                # Append dict directly to Y.Array
                # y-py automatically converts dicts to appropriate Yjs types
                content_array.append(txn, block)
        finally:
            # Transaction automatically commits when destroyed
            del txn

    def validate_round_trip(self, original: Dict[str, Any]) -> bool:
        """
        Verify lossless conversion Slate � Yjs � Slate.

        Args:
            original: Original Slate JSON

        Returns:
            True if round-trip conversion preserves data exactly
        """
        try:
            # Slate � Yjs
            ydoc = YDoc()
            self.populate_from_slate(ydoc, original)

            # Yjs � Slate
            converted = self.convert_to_slate(ydoc)

            # Deep equality check
            return self._deep_equal(original, converted)

        except Exception:
            return False

    def compute_checksum(self, slate_json: Dict[str, Any]) -> str:
        """
        Compute SHA256 checksum of Slate JSON for comparison.

        Args:
            slate_json: Slate JSON content

        Returns:
            Hex-encoded SHA256 checksum
        """
        # Normalize and serialize
        normalized = json.dumps(
            slate_json,
            sort_keys=True,
            separators=(',', ':')
        )

        # Compute SHA256
        checksum = hashlib.sha256(normalized.encode('utf-8')).hexdigest()
        return checksum

    # -------------------------------------------------------------------------
    # Private Helper Methods
    # -------------------------------------------------------------------------

    def _deep_equal(self, obj1: Any, obj2: Any) -> bool:
        """
        Deep equality comparison for nested dicts/lists.

        Handles numeric type coercion (int <-> float) since y-py
        converts all numbers to float.
        """
        # Handle numeric type coercion (int vs float)
        if isinstance(obj1, (int, float)) and isinstance(obj2, (int, float)):
            return obj1 == obj2

        if type(obj1) != type(obj2):
            return False

        if isinstance(obj1, dict):
            if set(obj1.keys()) != set(obj2.keys()):
                return False
            return all(
                self._deep_equal(obj1[key], obj2[key])
                for key in obj1.keys()
            )

        elif isinstance(obj1, list):
            if len(obj1) != len(obj2):
                return False
            return all(
                self._deep_equal(obj1[i], obj2[i])
                for i in range(len(obj1))
            )

        else:
            return obj1 == obj2


# Singleton instance for convenient import
converter = YjsToSlateConverter()
