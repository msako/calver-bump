import { nextCalVer } from './calver.js';
import { releaseNotes, renderChangelog } from './changelog.js';
import {
  prepareVersionFiles,
  readChangelog,
  releaseWarnings,
  writeReleaseFiles,
} from './files.js';
import { assertNoMergeInProgress, assertTagAvailable, currentBranch, git, gitLines, releaseGitCommands, tryFetchTags } from './git.js';

export async function planRelease(options = {}) {
  const { plan } = await prepareRelease(options.cwd ?? process.cwd(), options);
  return plan;
}

async function prepareRelease(cwd, options) {
  const remote = options.remote ?? 'origin';
  if (!options.noFetch) {
    await tryFetchTags(cwd, remote);
  }
  const existingTags = options.existingTags ?? await gitLines(cwd, ['tag', '--list']);
  const tagPrefix = String(options.tagPrefix ?? 'v');
  const version = nextCalVer({
    date: options.date,
    existingTags,
    format: options.format ?? 'short',
    tagPrefix,
  });
  const tag = `${tagPrefix}${version}`;
  const writes = options.changelogOnly ? [] : await prepareVersionFiles(cwd, version);
  let notes = null;
  if (!options.versionOnly) {
    const existingChangelog = await readChangelog(cwd);
    notes = await releaseNotes(cwd, { ...options, existingChangelog });
    writes.push({
      file: 'CHANGELOG.md',
      contents: renderChangelog(existingChangelog, { version, tag, notes, changelogSections: options.changelogSections }),
    });
  }
  const files = writes.map(({ file }) => file);
  const warnings = await releaseWarnings(cwd, {
    updatesVersion: !options.changelogOnly,
  });
  const commit = createsCommit(options);
  const tagRelease = commit && Boolean(options.tag || options.push);

  const plan = {
    version,
    tag,
    branch: await currentBranch(cwd),
    remote,
    previousTag: notes?.previousTag ?? null,
    range: notes?.range ?? null,
    files,
    warnings,
    actions: releaseActions({
      version,
      tag,
      commit,
      tagRelease,
      versionOnly: options.versionOnly,
      changelogOnly: options.changelogOnly,
      files,
    }),
  };
  return { plan, writes, commit, tagRelease };
}

export async function runRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const { plan, writes, commit, tagRelease } = await prepareRelease(cwd, options);

  if (options.dryRun) {
    return plan;
  }

  const commands = releaseGitCommands(plan);
  if (options.push && tagRelease && !commands.push) {
    throw new Error('Cannot push a release from detached HEAD. Check out a branch first.');
  }
  if (tagRelease) {
    await assertTagAvailable(cwd, plan.tag);
  }
  if (commit) {
    await assertNoMergeInProgress(cwd);
  }

  await writeReleaseFiles(cwd, writes);

  if (!commit) {
    return { ...plan, createdTag: null };
  }

  await git(cwd, commands.add);
  await git(cwd, commands.commit);
  if (tagRelease) {
    try {
      await git(cwd, commands.tag);
    } catch (error) {
      await git(cwd, ['reset', '--soft', 'HEAD~1']);
      throw new Error(`Failed to create git tag ${plan.tag}; release commit was undone and file changes were left in the working tree. ${error.message}`);
    }
  }

  return { ...plan, createdTag: tagRelease ? plan.tag : null };
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
