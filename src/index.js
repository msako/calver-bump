import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isoDate, nextCalVer } from './calver.js';

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
  const entry = `## ${version} - ${isoDate(date)}\n\n${formatReleaseNotes(changes)}\n`;
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
  const commits = await gitCommits(cwd, range);
  const commitUrlBuilder = await commitUrlBuilderForOrigin(cwd);
  const conventionalCommits = commits
    .filter((commit) => isConventionalCommit(commit.subject))
    .map((commit) => ({
      ...commit,
      url: commitUrlBuilder ? commitUrlBuilder(commit.hash) : null,
    }));
  return conventionalCommits.length > 0 ? conventionalCommits : ['No conventional commits in this release.'];
}

function isConventionalCommit(subject) {
  return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/.test(subject);
}

function formatReleaseNotes(changes) {
  if (changes.length === 1 && changes[0] === 'No conventional commits in this release.') {
    return `- ${changes[0]}`;
  }

  const features = changes.filter((change) => conventionalType(change.subject) === 'feat');
  const fixes = changes.filter((change) => conventionalType(change.subject) === 'fix');
  const other = changes.filter((change) => !['feat', 'fix'].includes(conventionalType(change.subject)));
  const sections = [
    ['Features', features],
    ['Fixes', fixes],
    ['Other Changes', other],
  ];

  return sections
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries]) => `### ${heading}\n\n${entries.map((entry) => `- ${formatCommitEntry(entry)}`).join('\n')}`)
    .join('\n\n');
}

function conventionalType(subject) {
  return /^(?<type>[a-z]+)(\([^)]+\))?!?: .+/.exec(subject)?.groups.type;
}

function formatCommitEntry(commit) {
  const shortHash = commit.hash.slice(0, 7);
  const suffix = commit.url ? ` ([${shortHash}](${commit.url}))` : ` (${shortHash})`;
  return `${commit.subject}${suffix}`;
}

async function gitCommits(cwd, range) {
  const { stdout } = await git(cwd, ['log', '--pretty=format:%H%x00%s', ...range]);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split('\0');
      return { hash, subject };
    });
}

async function commitUrlBuilderForOrigin(cwd) {
  try {
    const { stdout } = await git(cwd, ['remote', 'get-url', 'origin']);
    return commitUrlBuilder(stdout.trim());
  } catch {
    return null;
  }
}

function commitUrlBuilder(remote) {
  const parsed = parseGitRemote(remote);
  if (!parsed) {
    return null;
  }

  const baseUrl = `https://${parsed.host}/${parsed.repo}`;
  if (parsed.host === 'github.com') {
    return (hash) => `${baseUrl}/commit/${hash}`;
  }
  if (parsed.host.includes('gitlab')) {
    return (hash) => `${baseUrl}/-/commit/${hash}`;
  }

  return null;
}

function parseGitRemote(remote) {
  const sshMatch = /^git@(?<host>[^:]+):(?<repo>.+?)(?:\.git)?$/.exec(remote);
  if (sshMatch) {
    return sshMatch.groups;
  }

  const httpsMatch = /^https:\/\/(?<host>[^/]+)\/(?<repo>.+?)(?:\.git)?$/.exec(remote);
  if (httpsMatch) {
    return httpsMatch.groups;
  }

  return null;
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
  return tags[0] ?? null;
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
