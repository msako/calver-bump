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
3. Warns when `pnpm-lock.yaml` or `yarn.lock` is present, because those lockfiles do not store the root package version consistently.
4. Creates or prepends a `CHANGELOG.md` entry from conventional commits since the nearest reachable tag.
5. Creates a release commit.
6. Creates an annotated git tag.

## Usage

```bash
npx calver-bump
```

Preview the planned release without writing files:

```bash
npx calver-bump --dry-run
```

Print help:

```bash
npx calver-bump --help
```

Print the installed `calver-bump` package version:

```bash
npx calver-bump --version
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

Use an explicit changelog base tag:

```bash
npx calver-bump --from v1.35.0
```

Use local tags only without fetching from the configured remote:

```bash
npx calver-bump --no-fetch
```

Update only `package.json` and supported npm lockfiles:

```bash
npx calver-bump --version-only
```

Update only `CHANGELOG.md`:

```bash
npx calver-bump --changelog-only
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
  "types": ["feat", "fix", "perf"],
  "changelogSections": {
    "perf": "Performance",
    "security": "Security"
  }
}
```

## Runtime support

`calver-bump` supports Node.js LTS lines only. The current supported runtime range is Node.js 22 and Node.js 24.

## Publishing

The package includes a manual GitHub Actions publish workflow. Run the `Publish` workflow from GitHub after the package version has been bumped, tests pass, and the npm automation token is available as `NPM_TOKEN`.

## Notes

- The default `short` format is `YY.MMDD` for the first release of the day, then `YY.MMDD.1`, `YY.MMDD.2`, etc.
- The optional `compact` format is `YYMMDD` for the first release of the day, then `YYMMDD.1`, `YYMMDD.2`, etc.
- The optional `long` format is `YYYY.MM.DD` for the first release of the day, then `YYYY.MM.DD.1`, `YYYY.MM.DD.2`, etc.
- Changelog release headings use the CalVer version only and do not append a separate `YYYY-MM-DD` date.
- Existing `v`-prefixed tags are considered when calculating the next sequence number.
- Changelog ranges start from the nearest reachable tag, even when it is not a CalVer tag.
- Changelog entries include conventional commit subjects only, such as `feat:`, `fix(scope):`, or `chore!:`.
- Changelog entries are grouped into `Features`, `Fixes`, and `Other Changes` by default. Use `changelogSections` to assign additional conventional commit types to named sections.
- Changelog entries link to GitHub pull requests or GitLab merge requests when the local git message includes references such as `#123`, `Merge pull request #123`, `!123`, or `See merge request group/project!123`.
- Changelog entries fall back to commit hash links for GitHub and GitLab-style remotes when no pull/merge request reference is found.
- Release entries include a `Full Changelog` section with a deduped list of pull/merge requests found in the release range, including the local commit title when available.
- Later releases prepend only commits since the previous nearest reachable tag.
- Release tags are annotated so `git push --follow-tags <remote> <branch>` pushes them.
- The working tree must be clean before creating a real release.
- Existing release tags are rejected before files are written.
- If tag creation fails after the release commit, the CLI undoes its own commit and leaves the file changes in the working tree for inspection or recovery.
