import { nextCalVer } from './calver.js';
import { formatFullChangelog, formatReleaseHeading, formatReleaseNotes, releaseNotes } from './changelog.js';
import {
  readChangelog,
  releaseFiles,
  releaseWarnings,
  updatePackageLock,
  updatePackageVersion,
  writeChangelog,
} from './files.js';
import { assertTagAvailable, currentBranch, git, gitLines } from './git.js';

export async function planRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const existingTags = options.existingTags ?? await gitLines(cwd, ['tag', '--list']);
  const version = nextCalVer({
    date: options.date,
    existingTags,
    format: options.format ?? 'short',
  });
  const tag = `${options.tagPrefix ?? ''}${version}`;
  const notes = options.versionOnly
    ? null
    : await releaseNotes(cwd, { ...options, tag, existingChangelog: await readChangelog(cwd) });
  const files = await releaseFiles(cwd, {
    version: !options.changelogOnly,
    changelog: !options.versionOnly,
  });
  const warnings = await releaseWarnings(cwd, {
    updatesVersion: !options.changelogOnly,
  });

  return {
    version,
    tag,
    branch: await currentBranch(cwd),
    remote: options.remote ?? 'origin',
    previousTag: notes?.previousTag ?? null,
    range: notes?.range ?? null,
    files,
    warnings,
    actions: releaseActions({
      version,
      tag,
      commit: createsCommit(options),
      tagRelease: createsTag(options),
      versionOnly: options.versionOnly,
      changelogOnly: options.changelogOnly,
      files,
    }),
  };
}

export async function runRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const plan = await planRelease(options);

  if (options.dryRun) {
    return plan;
  }

  if (createsTag(options)) {
    await assertTagAvailable(cwd, plan.tag);
  }

  if (!options.changelogOnly) {
    await updatePackageVersion(cwd, plan.version);
    await updatePackageLock(cwd, plan.version);
  }
  if (!options.versionOnly) {
    await prependChangelog(cwd, plan.version, options);
  }

  if (!createsCommit(options)) {
    return { ...plan, createdTag: null };
  }

  await git(cwd, ['add', ...await releaseFiles(cwd)]);
  await git(cwd, ['commit', '-m', `chore(release): ${plan.version}`]);
  if (createsTag(options)) {
    try {
      await git(cwd, ['tag', '-a', plan.tag, '-m', `Release ${plan.version}`]);
    } catch (error) {
      await git(cwd, ['reset', '--soft', 'HEAD~1']);
      throw new Error(`Failed to create git tag ${plan.tag}; release commit was undone and file changes were left in the working tree. ${error.message}`);
    }
  }

  return createsTag(options) ? { ...plan, createdTag: plan.tag } : { ...plan, createdTag: null };
}

function releaseActions({ version, tag, commit = false, tagRelease = false, versionOnly = false, changelogOnly = false, files = [] }) {
  const actions = [];
  if (!changelogOnly) {
    actions.push(`update package.json version to ${version}`);
    if (files.some((file) => ['package-lock.json', 'npm-shrinkwrap.json'].includes(file))) {
      actions.push('update npm lockfile version metadata');
    }
  }
  if (!versionOnly) {
    actions.push(`prepend CHANGELOG.md entry for ${version}`);
  }
  if (commit) {
    actions.push(`create git commit chore(release): ${version}`);
  }
  if (tagRelease) {
    actions.push(`create git tag ${tag}`);
  }
  return actions;
}

function createsCommit(options) {
  return Boolean(options.commit || options.tag || options.push) && !options.skipCommit && !options.versionOnly && !options.changelogOnly;
}

function createsTag(options) {
  return Boolean(options.tag || options.push) && createsCommit(options);
}

async function prependChangelog(cwd, version, options = {}) {
  const existing = await readChangelog(cwd);

  const notes = await releaseNotes(cwd, {
    ...options,
    existingChangelog: existing,
    tag: `${options.tagPrefix ?? ''}${version}`,
  });
  const heading = formatReleaseHeading({
    version,
    previousTag: notes.previousTag,
    tag: options.tagPrefix ? `${options.tagPrefix}${version}` : version,
    compareUrlBuilder: notes.compareUrlBuilder,
  });
  const compareUrl = notes.previousTag && notes.compareUrlBuilder
    ? notes.compareUrlBuilder(notes.previousTag, options.tagPrefix ? `${options.tagPrefix}${version}` : version)
    : null;
  const entry = `${heading}\n\n${formatReleaseNotes(notes.changes, options.changelogSections)}${formatFullChangelog(notes.requests, compareUrl)}\n`;

  const body = existing.trim().startsWith('# Changelog')
    ? existing.replace(/^# Changelog\s*/, `# Changelog\n\n${entry}\n`)
    : `# Changelog\n\n${entry}\n${existing}`;

  await writeChangelog(cwd, body);
}
