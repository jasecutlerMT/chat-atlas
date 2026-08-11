#!/bin/sh
# Publishes the chat-atlas app (this folder only — nothing else from the
# private repository, never any data) to the public mirror that powers the
# in-app Update button.
#
# Release routine, run from the repository root:
#   1. Bump "version" in chat-atlas/version.json and commit to the app branch.
#   2. sh chat-atlas/scripts/publish-mirror.sh
#
# Requires push access to github.com/jasecutlerMT/chat-atlas.
set -e
cd "$(git rev-parse --show-toplevel)"
BRANCH_SHA="$(git subtree split --prefix=chat-atlas HEAD)"
git push https://github.com/jasecutlerMT/chat-atlas.git "$BRANCH_SHA:refs/heads/main" --force
echo "mirror updated: version $(node -e "console.log(require('./chat-atlas/version.json').version)")"
