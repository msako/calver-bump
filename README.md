# calver-bump

Release CLI for applications and internal tools that use readable CalVer versions.

Default version format:

```text
YY.MMDD
```

Default git tag format:

```text
vYY.MMDD
```

Example package version and git tag:

```text
26.0529
v26.0529
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

By default, `calver-bump` updates release files, creates a release commit, and creates an annotated `v`-prefixed git tag.
After creating the tag on a branch, `calver-bump` asks whether to push the branch and tag to the configured remote when both input and output are terminals. Press Enter to keep the release local and see the next steps.
The push and the printed command use the release commit and annotated tag captured before the prompt. Git updates the destination branch and tag atomically, so the remote must support atomic pushes.

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

Create an unprefixed git tag while keeping the default package version unchanged:

```bash
npx calver-bump --tag-prefix ""
```

Push the release branch and annotated tag without confirmation.

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

Create a release commit after updating files:

```bash
npx calver-bump --commit
```

Create a release commit and annotated tag after updating files:

```bash
npx calver-bump --tag
```

Explicitly update files without creating a release commit or tag:

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

Explicit `--commit`, `--tag`, `--push`, and `--skip-commit` flags override the configured Git action.
Set `"push": true` to push the release without confirmation.

## Runtime support

`calver-bump` supports Node.js LTS lines only. The current supported runtime range is Node.js 22 and Node.js 24.

## Publishing

The package includes a manual GitHub Actions publish workflow. Run the `Publish` workflow from GitHub after the package version has been bumped, tests pass, and the npm automation token is available as `NPM_TOKEN`.

## Notes

- The default `short` format is `YY.MMDD` for the first release of the day, then `YY.MMDD.1`, `YY.MMDD.2`, etc.
- The optional `compact` format is `YYMMDD` for the first release of the day, then `YYMMDD.1`, `YYMMDD.2`, etc.
- The optional `long` format is `YYYY.MM.DD` for the first release of the day, then `YYYY.MM.DD.1`, `YYYY.MM.DD.2`, etc.
- Changelog release headings use the CalVer version only and do not append a separate `YYYY-MM-DD` date.
- The next sequence number uses existing tags with the configured prefix, the `v` prefix, or an empty prefix.
- The CLI fetches remote tags before choosing the version and disables pruning for that fetch. Use `--no-fetch` to use local tags only.
- Changelog ranges start from the nearest reachable tag, even when it is not a CalVer tag.
- Changelog entries include conventional commit subjects only, such as `feat:`, `fix(scope):`, or `chore!:`.
- Changelog entries are grouped into `Features`, `Fixes`, and `Other Changes` by default. Use `changelogSections` to assign additional conventional commit types to named sections.
- Changelog entries show a seven-character commit hash in plain text. If the commit message includes a request reference, the entry also shows its label, such as `#123` or `!123`.
- The `Full Changelog` section lists each pull request or merge request once, with its commit title when available.
- For GitHub and GitLab remotes, the `Full Changelog` section includes a `Compare changes` link when the release has a base tag.
- Later releases prepend only commits since the previous nearest reachable tag.
- Plain `calver-bump` creates the release commit and annotated tag by default.
- Use `--commit` to create only the release commit.
- Use `--tag` to create the release commit and annotated tag.
- Use `--skip-commit` to update files only without creating a release commit or tag.
- Use `--push` from an attached branch to push that branch and the exact annotated release tag.
- A release that creates a commit requires you to finish or abort an in-progress merge first. Previews and file-only modes remain available during a merge.
- Release commits include only the files listed in the release plan. Unrelated staged changes stay staged.
- Existing release tags are rejected before files are written.
- If tag creation fails after the release commit, the CLI undoes its own commit and leaves the file changes in the working tree for inspection or recovery.
