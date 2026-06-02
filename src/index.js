import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { nextCalVer } from './calver.js';

const execFile = promisify(execFileCallback);

export async function planRelease(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const existingTags = options.existingTags ?? await gitLines(cwd, ['tag', '--list']);
  const version = nextCalVer({
    date: options.date,
    existingTags,
    format: options.format ?? 'short',
  });
  const tag = `${options.tagPrefix ?? ''}${version}`;

  return {
    version,
    tag,
    branch: await currentBranch(cwd),
    remote: options.remote ?? 'origin',
    actions: releaseActions({ version, tag, skipCommit: options.skipCommit }),
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
  await prependChangelog(cwd, plan.version, options.date ?? new Date(), options);

  if (options.skipCommit) {
    return { ...plan, tag: null };
  }

  await git(cwd, ['add', ...await releaseFiles(cwd)]);
  await git(cwd, ['commit', '-m', `chore(release): ${plan.version}`]);
  try {
    await git(cwd, ['tag', '-a', plan.tag, '-m', `Release ${plan.version}`]);
  } catch (error) {
    await git(cwd, ['reset', '--hard', 'HEAD~1']);
    throw new Error(`Failed to create git tag ${plan.tag}; rolled back release commit. ${error.message}`);
  }

  return plan;
}

function releaseActions({ version, tag, skipCommit = false }) {
  const actions = [
    `update package.json version to ${version}`,
    `prepend CHANGELOG.md entry for ${version}`,
  ];
  if (!skipCommit) {
    actions.push(`create git commit chore(release): ${version}`);
    actions.push(`create git tag ${tag}`);
  }
  return actions;
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

async function prependChangelog(cwd, version, date, options = {}) {
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  let existing = '';

  try {
    existing = await readFile(changelogPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const notes = await releaseNotes(cwd, { ...options, existingChangelog: existing });
  const heading = formatReleaseHeading({
    version,
    previousTag: notes.previousTag,
    tag: `${options.tagPrefix ?? ''}${version}`,
    compareUrlBuilder: notes.compareUrlBuilder,
  });
  const entry = `${heading}\n\n${formatReleaseNotes(notes.changes)}${formatFullChangelog(notes.requests)}\n`;

  const body = existing.trim().startsWith('# Changelog')
    ? existing.replace(/^# Changelog\s*/, `# Changelog\n\n${entry}\n`)
    : `# Changelog\n\n${entry}\n${existing}`;

  await writeFile(changelogPath, body);
}

async function releaseNotes(cwd, options = {}) {
  await fetchTags(cwd, options.remote ?? 'origin');
  const latestTag = await latestReleaseTag(cwd, options.existingChangelog ?? '');
  const range = latestTag ? [`${latestTag}..HEAD`] : [];
  const commits = await gitCommits(cwd, range);
  const remoteUrl = await getRemoteUrl(cwd, options.remote ?? 'origin');
  const commitUrlBuilder = remoteUrl ? buildCommitUrlBuilder(remoteUrl) : null;
  const compareUrlBuilder = remoteUrl ? buildCompareUrlBuilder(remoteUrl) : null;
  const requestUrlBuilder = remoteUrl ? buildRequestUrlBuilder(remoteUrl) : null;
  const allowedTypes = options.types ?? ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
  const conventionalCommits = commits
    .map((commit) => ({ ...commit, subject: conventionalSubjectForCommit(commit) ?? commit.subject }))
    .filter((commit) => isConventionalCommit(commit.subject))
    .filter((commit) => allowedTypes.includes(conventionalType(commit.subject)))
    .filter((commit) => !isCommitInChangelog(commit, options.existingChangelog ?? ''))
    .map((commit) => ({
      ...commit,
      request: requestForCommit(commit, requestUrlBuilder),
      url: commitUrlBuilder ? commitUrlBuilder(commit.hash) : null,
    }));
  const requests = uniqueRequests(commits.map((commit) => requestForCommit(commit, requestUrlBuilder)).filter(Boolean));
  return {
    previousTag: latestTag,
    compareUrlBuilder,
    changes: conventionalCommits.length > 0 ? conventionalCommits : ['No conventional commits in this release.'],
    requests,
  };
}

function formatReleaseHeading({ version, previousTag, tag, compareUrlBuilder }) {
  const label = previousTag && compareUrlBuilder
    ? `[${version}](${compareUrlBuilder(previousTag, tag)})`
    : version;
  return `## ${label}`;
}

function isCommitInChangelog(commit, changelog) {
  if (!changelog) return false;
  return changelog.includes(commit.hash) || changelog.includes(commit.hash.slice(0, 7));
}

function isConventionalCommit(subject) {
  return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/.test(subject);
}

function conventionalSubjectForCommit(commit) {
  return commitLines(commit).find((line) => isConventionalCommit(line)) ?? null;
}

function commitLines(commit) {
  return [commit.subject, ...(commit.body ?? '').split('\n')]
    .map((line) => line.trim())
    .filter(Boolean);
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

function formatFullChangelog(requests) {
  if (requests.length === 0) {
    return '';
  }
  return `\n\n### Full Changelog\n\n${requests.map((request) => `- ${formatRequestEntry(request)}`).join('\n')}`;
}

function conventionalType(subject) {
  return /^(?<type>[a-z]+)(\([^)]+\))?!?: .+/.exec(subject)?.groups.type;
}

function formatCommitEntry(commit) {
  const shortHash = commit.hash.slice(0, 7);
  const suffix = commit.request
    ? ` (${formatRequestLink(commit.request)})`
    : commit.url ? ` ([${shortHash}](${commit.url}))` : ` (${shortHash})`;
  return `${commit.subject}${suffix}`;
}

function formatRequestLink(request) {
  return request.url ? `[${request.label}](${request.url})` : request.label;
}

function formatRequestEntry(request) {
  return request.title ? `${formatRequestLink(request)} ${request.title}` : formatRequestLink(request);
}

async function gitCommits(cwd, range) {
  const { stdout } = await git(cwd, ['log', '--pretty=format:%H%x00%s%x00%B%x1e', ...range]);
  return stdout
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.replace(/^\n+|\n+$/g, '').split('\0');
      return { hash, subject, body };
    });
}

async function getRemoteUrl(cwd, remote) {
  try {
    const { stdout } = await git(cwd, ['remote', 'get-url', remote]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function buildCommitUrlBuilder(remote) {
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

function buildCompareUrlBuilder(remote) {
  const parsed = parseGitRemote(remote);
  if (!parsed) {
    return null;
  }

  const baseUrl = `https://${parsed.host}/${parsed.repo}`;
  if (parsed.host === 'github.com') {
    return (from, to) => `${baseUrl}/compare/${from}...${to}`;
  }
  if (parsed.host.includes('gitlab')) {
    return (from, to) => `${baseUrl}/-/compare/${from}...${to}`;
  }

  return null;
}

function buildRequestUrlBuilder(remote) {
  const parsed = parseGitRemote(remote);
  if (!parsed) {
    return null;
  }

  const baseUrl = `https://${parsed.host}/${parsed.repo}`;
  if (parsed.host === 'github.com') {
    return (request) => request.provider === 'github' ? `${baseUrl}/pull/${request.number}` : null;
  }
  if (parsed.host.includes('gitlab')) {
    return (request) => request.provider === 'gitlab' ? `${baseUrl}/-/merge_requests/${request.number}` : null;
  }

  return null;
}

function requestForCommit(commit, requestUrlBuilder) {
  const request = parseRequestReference(`${commit.subject}\n${commit.body ?? ''}`);
  if (!request) {
    return null;
  }
  return {
    ...request,
    title: requestTitleForCommit(commit),
    url: requestUrlBuilder ? requestUrlBuilder(request) : null,
  };
}

function requestTitleForCommit(commit) {
  const conventionalSubject = conventionalSubjectForCommit(commit);
  if (conventionalSubject) {
    return conventionalSubject;
  }

  return commitLines(commit)
    .find((line) => line && !parseRequestReference(line) && !/^Merge\b/i.test(line)) ?? null;
}

function parseRequestReference(message) {
  const gitlabMerge = /(?:^|\s)(?:See merge request\s+\S+!|!)(?<number>\d+)(?=\D|$)/i.exec(message);
  if (gitlabMerge) {
    return { provider: 'gitlab', number: gitlabMerge.groups.number, label: `!${gitlabMerge.groups.number}` };
  }

  const githubPull = /(?:Merge pull request\s+#|#)(?<number>\d+)(?=\D|$)/i.exec(message);
  if (githubPull) {
    return { provider: 'github', number: githubPull.groups.number, label: `#${githubPull.groups.number}` };
  }

  return null;
}

function uniqueRequests(requests) {
  const seen = new Set();
  const unique = [];
  for (const request of requests) {
    const key = `${request.provider}:${request.number}`;
    if (seen.has(key)) {
      const existing = unique.find((candidate) => `${candidate.provider}:${candidate.number}` === key);
      if (existing && !existing.title && request.title) {
        existing.title = request.title;
      }
      continue;
    }
    seen.add(key);
    unique.push(request);
  }
  return unique;
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

async function latestReleaseTag(cwd, changelog) {
  const changelogTag = latestChangelogCompareTarget(changelog);
  if (changelogTag && await tagExists(cwd, changelogTag)) {
    return changelogTag;
  }
  return latestReachableTag(cwd);
}

function latestChangelogCompareTarget(changelog) {
  const match = /^## \[[^\]]+\]\([^)]*\/(?:-\/)?compare\/[^)]*?\.{3}(?<tag>[^)\s]+)\)/m.exec(changelog);
  return match?.groups.tag ?? null;
}

async function tagExists(cwd, tag) {
  try {
    await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{}`]);
    return true;
  } catch {
    return false;
  }
}

async function latestReachableTag(cwd) {
  try {
    const { stdout } = await git(cwd, ['describe', '--tags', '--abbrev=0']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function fetchTags(cwd, remote) {
  try {
    await git(cwd, ['remote', 'get-url', remote]);
    await git(cwd, ['fetch', '--tags', remote]);
  } catch {
    // Local/offline repos can still release using tags already present.
  }
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
