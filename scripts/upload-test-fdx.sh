#!/bin/bash

# Upload Test FDX Script
# Usage: ./upload-test-fdx.sh <path-to-fdx-file> <firebase-token>

set -e

FDX_FILE=$1
FIREBASE_TOKEN=$2
API_URL="http://localhost:8000/api/fdx/upload"

if [ -z "$FDX_FILE" ]; then
  echo "Error: FDX file path required"
  echo "Usage: $0 <path-to-fdx-file> <firebase-token>"
  exit 1
fi

if [ -z "$FIREBASE_TOKEN" ]; then
  echo "Error: Firebase token required"
  echo "Usage: $0 <path-to-fdx-file> <firebase-token>"
  echo ""
  echo "To get your token:"
  echo "1. Sign in to http://localhost:3102/test-tiptap"
  echo "2. Open browser console"
  echo "3. Run: await firebase.auth().currentUser.getIdToken()"
  exit 1
fi

if [ ! -f "$FDX_FILE" ]; then
  echo "Error: File not found: $FDX_FILE"
  exit 1
fi

echo "Uploading FDX file: $FDX_FILE"
echo "API URL: $API_URL"
echo ""

# Upload the file
response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$API_URL" \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -F "file=@$FDX_FILE")

# Split response and status
body=$(echo "$response" | sed -n '1,/^HTTP_STATUS:/p' | sed '$d')
status=$(echo "$response" | grep "HTTP_STATUS:" | sed 's/HTTP_STATUS://')

echo "HTTP Status: $status"
echo ""

if [ "$status" -eq 201 ]; then
  echo "✅ Upload successful!"
  echo ""
  echo "Response:"
  echo "$body" | python3 -m json.tool
  echo ""
  echo "Script ID for testing:"
  echo "$body" | python3 -c "import sys, json; print(json.load(sys.stdin)['script_id'])"
else
  echo "❌ Upload failed!"
  echo ""
  echo "Response:"
  echo "$body"
  exit 1
fi
