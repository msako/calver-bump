# calver-bump

Release CLI for applications and internal tools that use readable CalVer versions.

Default version and tag format:

```text
YYYY.MM.DD.N
```

Example:

```text
2026.05.29.1
```

## What it does

1. Bumps `package.json` to the next CalVer version.
2. Updates `package-lock.json` or `npm-shrinkwrap.json` when present.
3. Creates or prepends a `CHANGELOG.md` entry from git commits since the last CalVer tag.
4. Creates a release commit.
5. Creates a git tag.

## Usage

```bash
npx calver-bump
```

Preview the planned release without writing files:

```bash
npx calver-bump --dry-run
```

Use compact CalVer instead:

```bash
npx calver-bump --format compact
```

## Notes

- The default `dotted` format is `YYYY.MM.DD.N`.
- The optional `compact` format is `YYYYMMDD.N`.
- Existing `v`-prefixed tags are considered when calculating the next sequence number.
- Changelog ranges ignore non-CalVer tags.
- The working tree must be clean before creating a real release.
- If tag creation fails after the release commit, the CLI rolls back its own release commit.
