# calver-bump

Release CLI for applications and internal tools that use readable CalVer versions.

Default version and tag format:

```text
YY.MMDD
```

Example:

```text
26.0529
```

## What it does

1. Bumps `package.json` to the next CalVer version.
2. Updates `package-lock.json` or `npm-shrinkwrap.json` when present.
3. Creates or prepends a `CHANGELOG.md` entry from conventional commits since the nearest reachable tag.
4. Creates a release commit.
5. Creates an annotated git tag.

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

Use long CalVer instead:

```bash
npx calver-bump --format long
```

Create a `v`-prefixed git tag while keeping `package.json` unprefixed:

```bash
npx calver-bump --tag-prefix v
```

Push the release commit and annotated tag:

```bash
npx calver-bump --push
```

Push to a different remote:

```bash
npx calver-bump --push --remote upstream
```

Only include selected conventional commit types:

```bash
npx calver-bump --types feat,fix,perf
```

Update files without creating a release commit or tag:

```bash
npx calver-bump --skip-commit
```

## Configuration

Project defaults can be stored in `.calverbumprc.json`:

```json
{
  "format": "short",
  "tagPrefix": "v",
  "remote": "origin",
  "types": ["feat", "fix", "perf"]
}
```

## Notes

- The default `short` format is `YY.MMDD` for the first release of the day, then `YY.MMDD.1`, `YY.MMDD.2`, etc.
- The optional `compact` format is `YYMMDD` for the first release of the day, then `YYMMDD.1`, `YYMMDD.2`, etc.
- The optional `long` format is `YYYY.MM.DD` for the first release of the day, then `YYYY.MM.DD.1`, `YYYY.MM.DD.2`, etc.
- Existing `v`-prefixed tags are considered when calculating the next sequence number.
- Changelog ranges start from the nearest reachable tag, even when it is not a CalVer tag.
- Changelog entries include conventional commit subjects only, such as `feat:`, `fix(scope):`, or `chore!:`.
- Changelog entries are grouped into `Features`, `Fixes`, and `Other Changes`.
- Changelog entries link to their commit hash for GitHub and GitLab-style `origin` remotes.
- Later releases prepend only commits since the previous nearest reachable tag.
- Release tags are annotated so `git push --follow-tags <remote> <branch>` pushes them.
- The working tree must be clean before creating a real release.
- If tag creation fails after the release commit, the CLI rolls back its own release commit.
