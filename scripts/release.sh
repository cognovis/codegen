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

# Refuse a version that does not advance the one it replaces.
#
# .github/workflows/release.yml publishes with `npm publish --tag latest`, so a
# backwards version repoints latest at older code for every consumer. The
# derivation above is the realistic way to get one: a synchronization fetches
# upstream tags into this repository, and a git-cliff tag selection that admits
# them answers with upstream's line instead of the fork's. This check is the
# safety net under that, and it applies equally to an explicit argument.
CURRENT_VERSION=$(node -p "require('./package.json').version")
if ! node -e '
const parse = (v) => {
    const dash = v.indexOf("-");
    const core = (dash === -1 ? v : v.slice(0, dash)).split(".").map(Number);
    if (core.length !== 3 || core.some((n) => !Number.isInteger(n) || n < 0)) return null;
    return { core, pre: dash === -1 ? null : v.slice(dash + 1).split(".") };
};
const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
    // A version with a prerelease ranks below the same version without one.
    if (a.pre === null || b.pre === null) return (b.pre === null ? 0 : 1) - (a.pre === null ? 0 : 1);
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const l = a.pre[i];
        const r = b.pre[i];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        const ln = /^[0-9]+$/.test(l);
        const rn = /^[0-9]+$/.test(r);
        if (ln && rn) {
            if (Number(l) !== Number(r)) return Number(l) - Number(r);
            continue;
        }
        if (ln !== rn) return ln ? -1 : 1;
        if (l !== r) return l < r ? -1 : 1;
    }
    return 0;
};
const next = parse(process.argv[1]);
const current = parse(process.argv[2]);
// Fail closed: a version neither side can parse is not proof of progress.
process.exit(next && current && compare(next, current) > 0 ? 0 : 1);
' "$VERSION" "$CURRENT_VERSION"; then
    echo "❌ Error: Version $VERSION does not advance the current version $CURRENT_VERSION"
    echo 'A release must be strictly greater: npm publish --tag latest would otherwise move'
    echo 'the published dist-tag backwards for every consumer.'
    echo 'If this version was derived, check the tag_pattern in cliff.toml and the tags this'
    echo 'repository carries (git tag --list) - a synchronization also fetches upstream tags.'
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
