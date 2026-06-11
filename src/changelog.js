import { fetchTags, getRemoteUrl, gitCommits, latestReachableTag, tagExists } from './git.js';

const DEFAULT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const DEFAULT_CHANGELOG_SECTIONS = {
  feat: 'Features',
  fix: 'Fixes',
};

export async function releaseNotes(cwd, options = {}) {
  if (!options.noFetch) {
    await fetchTags(cwd, options.remote ?? 'origin');
  }
  const latestTag = options.from ?? await latestReleaseTag(cwd, options.existingChangelog ?? '');
  const range = latestTag ? [`${latestTag}..HEAD`] : [];
  const commits = await gitCommits(cwd, range);
  const remoteUrl = await getRemoteUrl(cwd, options.remote ?? 'origin');
  const commitUrlBuilder = remoteUrl ? buildCommitUrlBuilder(remoteUrl) : null;
  const compareUrlBuilder = remoteUrl ? buildCompareUrlBuilder(remoteUrl) : null;
  const requestUrlBuilder = remoteUrl ? buildRequestUrlBuilder(remoteUrl) : null;
  const allowedTypes = options.types ?? DEFAULT_TYPES;
  const conventionalCommits = dedupeConventionalChanges(commits
    .map((commit) => ({ ...commit, subject: conventionalSubjectForCommit(commit) ?? commit.subject }))
    .filter((commit) => isConventionalCommit(commit.subject))
    .filter((commit) => allowedTypes.includes(conventionalType(commit.subject)))
    .filter((commit) => !isCommitInChangelog(commit, options.existingChangelog ?? ''))
    .map((commit) => ({
      ...commit,
      request: requestForCommit(commit, requestUrlBuilder),
      url: commitUrlBuilder ? commitUrlBuilder(commit.hash) : null,
    })));
  const requests = uniqueRequests(commits.map((commit) => requestForCommit(commit, requestUrlBuilder)).filter(Boolean));
  return {
    previousTag: latestTag,
    range: latestTag ? `${latestTag}..HEAD` : 'HEAD',
    compareUrlBuilder,
    changes: conventionalCommits.length > 0 ? conventionalCommits : ['No conventional commits in this release.'],
    requests,
  };
}

export function formatReleaseHeading({ version, previousTag, tag, compareUrlBuilder }) {
  const label = previousTag && compareUrlBuilder
    ? `[${version}](${compareUrlBuilder(previousTag, tag)})`
    : version;
  return `## ${label}`;
}

export function formatReleaseNotes(changes, sectionConfig = {}) {
  if (changes.length === 1 && changes[0] === 'No conventional commits in this release.') {
    return `- ${changes[0]}`;
  }

  const sectionMap = { ...DEFAULT_CHANGELOG_SECTIONS, ...sectionConfig };
  const grouped = new Map();
  const other = [];
  for (const change of changes) {
    const heading = sectionMap[conventionalType(change.subject)];
    if (!heading) {
      other.push(change);
      continue;
    }
    grouped.set(heading, [...(grouped.get(heading) ?? []), change]);
  }
  const sections = [...grouped.entries()];
  if (other.length > 0) {
    sections.push(['Other Changes', other]);
  }

  return sections
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries]) => `### ${heading}\n\n${entries.map((entry) => `- ${formatCommitEntry(entry)}`).join('\n')}`)
    .join('\n\n');
}

export function formatFullChangelog(requests) {
  if (requests.length === 0) {
    return '';
  }
  return `\n\n### Full Changelog\n\n${requests.map((request) => `- ${formatRequestEntry(request)}`).join('\n')}`;
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

function dedupeConventionalChanges(changes) {
  const deduped = [];
  for (const change of changes) {
    const existingIndex = deduped.findIndex((candidate) => candidate.subject === change.subject);
    if (existingIndex < 0) {
      deduped.push(change);
      continue;
    }
    if (!deduped[existingIndex].request && change.request) {
      deduped[existingIndex] = change;
    }
  }
  return deduped;
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
