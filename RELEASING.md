# Releasing

## Version bump + publish

```bash
# 1. Update CHANGELOG.md with what changed

# 2. Stage the changelog
git add CHANGELOG.md

# 3. Bump version (picks up staged files into the version commit)
npm version patch   # bug fixes:     1.0.0 → 1.0.1
npm version minor   # new features:  1.0.0 → 1.1.0
npm version major   # breaking:      1.0.0 → 2.0.0

# 4. Publish to npm (requires granular access token with publish permissions)
npm publish

# 5. Push commit + tag
git push && git push --tags
```

`npm version` automatically:
- Bumps the version in `package.json`
- Creates a git commit
- Creates a git tag (`vX.Y.Z`)

## Local dev testing

Run the installer directly from the repo to install your working copy:

```bash
node bin/install.js --global
```

Re-run after any source file changes to update `~/.claude/`.

## Uninstall (for testing)

```bash
node bin/install.js --global --uninstall
```
