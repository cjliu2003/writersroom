"""
Test script to verify block structure transformation
"""

# Example block from database (old format)
block_from_db = {
    "text": "INT. HALLWAY - SASKATOON POLICE DEPARTMENT – NIGHT",
    "type": "scene_heading",
    "metadata": None
}

print("=" * 60)
print("BLOCK TRANSFORMATION TEST")
print("=" * 60)

print("\nOriginal block from DB:")
print(block_from_db)

# Simulate backend transformation logic
if 'children' not in block_from_db:
    block_from_db['children'] = [{'text': block_from_db.get('text', '')}]
    print("\nAfter adding children:")
    print(block_from_db)

if 'text' in block_from_db and 'type' in block_from_db:
    block_copy = {
        'type': block_from_db['type'],
        'children': block_from_db.get('children', [{'text': block_from_db['text']}])
    }
    if 'metadata' in block_from_db:
        block_copy['metadata'] = block_from_db['metadata']

    print("\nBlock_copy for Yjs (what gets appended):")
    print(block_copy)

    print("\nExpected Slate structure:")
    expected = {
        'type': 'scene_heading',
        'children': [{'text': 'INT. HALLWAY - SASKATOON POLICE DEPARTMENT – NIGHT'}]
    }
    print(expected)

    print("\nStructures match:", block_copy['type'] == expected['type'] and
          block_copy['children'] == expected['children'])
