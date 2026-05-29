import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isoDate, isCalVerTag, nextCalVer } from './calver.js';

const execFile = promisify(execFileCallback);

export async function planRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const existingTags = options.existingTags ?? await gitLines(cwd, ['tag', '--list']);
  const version = nextCalVer({
    date: options.date,
    existingTags,
    format: options.format ?? 'dotted',
  });

  return {
    version,
    branch: await currentBranch(cwd),
    actions: releaseActions(version),
  };
}

export async function runRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const plan = await planRelease(options);

  if (options.dryRun) {
    return plan;
  }

  await assertCleanWorktree(cwd);
  await updatePackageVersion(cwd, plan.version);
  await updatePackageLock(cwd, plan.version);
  await prependChangelog(cwd, plan.version, options.date ?? new Date());
  await git(cwd, ['add', ...await releaseFiles(cwd)]);
  await git(cwd, ['commit', '-m', `chore(release): ${plan.version}`]);
  try {
    await git(cwd, ['tag', plan.version]);
  } catch (error) {
    await git(cwd, ['reset', '--hard', 'HEAD~1']);
    throw new Error(`Failed to create git tag ${plan.version}; rolled back release commit. ${error.message}`);
  }

  return plan;
}

function releaseActions(version) {
  return [
    `update package.json version to ${version}`,
    `prepend CHANGELOG.md entry for ${version}`,
    `create git commit chore(release): ${version}`,
    `create git tag ${version}`,
  ];
}

async function updatePackageVersion(cwd, version) {
  const packagePath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.version = version;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function updatePackageLock(cwd, version) {
  for (const fileName of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const filePath = path.join(cwd, fileName);
    let lock;
    try {
      lock = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    if (typeof lock.version === 'string') {
      lock.version = version;
    }
    if (lock.packages?.[''] && typeof lock.packages[''].version === 'string') {
      lock.packages[''].version = version;
    }

    await writeFile(filePath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

async function releaseFiles(cwd) {
  const candidates = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'CHANGELOG.md'];
  const files = [];
  for (const candidate of candidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      files.push(candidate);
    }
  }
  return files;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function prependChangelog(cwd, version, date) {
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  const changes = await releaseNotes(cwd);
  const entry = `## ${version} - ${isoDate(date)}\n\n${changes.map((change) => `- ${change}`).join('\n')}\n`;
  let existing = '';

  try {
    existing = await readFile(changelogPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const body = existing.trim().startsWith('# Changelog')
    ? existing.replace(/^# Changelog\s*/, `# Changelog\n\n${entry}\n`)
    : `# Changelog\n\n${entry}\n${existing}`;

  await writeFile(changelogPath, body);
}

async function releaseNotes(cwd) {
  const latestTag = await latestReachableTag(cwd);
  const range = latestTag ? [`${latestTag}..HEAD`] : [];
  const lines = await gitLines(cwd, ['log', '--pretty=%s', ...range]);
  return lines.length > 0 ? lines : ['Initial internal release.'];
}

async function latestReachableTag(cwd) {
  const tags = await gitLines(cwd, [
    'for-each-ref',
    '--merged',
    'HEAD',
    '--sort=-creatordate',
    '--format=%(refname:short)',
    'refs/tags',
  ]);
  return tags.find(isCalVerTag) ?? null;
}

async function currentBranch(cwd) {
  try {
    const { stdout } = await git(cwd, ['branch', '--show-current']);
    return stdout.trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

async function assertCleanWorktree(cwd) {
  const status = await gitLines(cwd, ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.');
  }
}

async function gitLines(cwd, args) {
  const { stdout } = await git(cwd, args);
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function git(cwd, args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}
