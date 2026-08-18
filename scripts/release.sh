#!/bin/bash
set -e

# Resolve git-cliff: prefer the binary on PATH, fall back to the npm package
if command -v git-cliff >/dev/null 2>&1; then
    CLIFF="git-cliff"
else
    CLIFF="bunx git-cliff"
fi

VERSION=$1

# Derive the next version from conventional commits when none is given
if [ -z "$VERSION" ]; then
    VERSION=$($CLIFF --bumped-version 2>/dev/null | sed 's/^v//')
    echo "Derived next version from commits: $VERSION"
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo "❌ Error: Invalid version format"
    echo "Usage: bun run release [version]"
    echo "Example: bun run release 0.0.18 (or omit to derive from conventional commits)"
    exit 1
fi

# Check if we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "❌ Error: Releases can only be made from the main branch"
    echo "Current branch: $CURRENT_BRANCH"
    echo "Please switch to main branch first: git checkout main"
    exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Error: Working tree has uncommitted changes"
    echo "Please commit or stash your changes before releasing"
    exit 1
fi

echo "📦 Releasing version $VERSION..."

# Update package.json version
echo "Updating package.json..."
npm version $VERSION --no-git-tag-version

# Generate the changelog for this release
echo "Generating CHANGELOG.md..."
$CLIFF --tag "v$VERSION" -o CHANGELOG.md

# Commit the changes
echo "Committing changes..."
git add package.json CHANGELOG.md
git commit -m "chore: bump version to $VERSION"

# Create and push tag
echo "Creating and pushing tag v$VERSION..."
git tag "v$VERSION"
git push origin HEAD
git push origin "v$VERSION"

echo "✅ Successfully released version $VERSION"
