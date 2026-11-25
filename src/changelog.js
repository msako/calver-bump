import { getRemoteUrl, gitCommits, latestReachableTag, tagExists } from './git.js';

const DEFAULT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const DEFAULT_CHANGELOG_SECTIONS = {
  feat: 'Features',
  fix: 'Fixes',
};

export async function releaseNotes(cwd, options = {}) {
  const existingChangelog = options.existingChangelog ?? '';
  const latestTag = options.from ?? await latestReleaseTag(cwd, existingChangelog);
  const range = latestTag ? [`${latestTag}..HEAD`] : [];
  const commits = (await gitCommits(cwd, range))
    .map(parseCommit)
    .filter((commit) => !commit.isRelease);
  const remoteUrl = await getRemoteUrl(cwd, options.remote ?? 'origin');
  const compareUrlBuilder = remoteUrl ? buildCompareUrlBuilder(remoteUrl) : null;
  const allowedTypes = options.types ?? DEFAULT_TYPES;
  const conventionalCommits = dedupeConventionalChanges(commits
    .filter((commit) => commit.type && allowedTypes.includes(commit.type))
    .filter((commit) => !isCommitInChangelog(commit, existingChangelog)));
  const requests = uniqueRequests(commits.map((commit) => commit.request).filter(Boolean));
  return {
    previousTag: latestTag,
    range: latestTag ? `${latestTag}..HEAD` : 'HEAD',
    compareUrlBuilder,
    changes: conventionalCommits.length > 0 ? conventionalCommits : ['No conventional commits in this release.'],
    requests,
  };
}

export function renderChangelog(existing, { version, tag, notes, changelogSections }) {
  const compareUrl = notes.previousTag && notes.compareUrlBuilder
    ? notes.compareUrlBuilder(notes.previousTag, tag)
    : null;
  const changes = formatReleaseNotes(notes.changes, changelogSections);
  const fullChangelog = formatFullChangelog(notes.requests, compareUrl);
  const entry = `## ${version}\n\n${changes}${fullChangelog}\n`;

  return existing.trim().startsWith('# Changelog')
    ? existing.replace(/^# Changelog\s*/, `# Changelog\n\n${entry}\n`)
    : `# Changelog\n\n${entry}\n${existing}`;
}

export function formatReleaseNotes(changes, sectionConfig = {}) {
  if (changes.length === 1 && changes[0] === 'No conventional commits in this release.') {
    return `- ${changes[0]}`;
  }

  const sectionMap = { ...DEFAULT_CHANGELOG_SECTIONS, ...sectionConfig };
  const grouped = new Map();
  const other = [];
  for (const change of changes) {
    const heading = sectionMap[change.type ?? conventionalType(change.subject)];
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

export function formatFullChangelog(requests, compareUrl = null) {
  const entries = [
    ...requests.map((request) => formatRequestEntry(request)),
    ...(compareUrl ? [`[Compare changes](${compareUrl})`] : []),
  ];
  if (entries.length === 0) {
    return '';
  }
  return `\n\n### Full Changelog\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`;
}

async function latestReleaseTag(cwd, changelog) {
  const changelogTag = latestChangelogCompareTarget(changelog);
  if (changelogTag && await tagExists(cwd, changelogTag)) {
    return changelogTag;
  }
  return latestReachableTag(cwd);
}

function latestChangelogCompareTarget(changelog) {
  const match = /\[[^\]]+\]\([^)]*\/(?:-\/)?compare\/[^)]*?\.{3}(?<tag>[^)\s]+)\)/m.exec(changelog);
  return match?.groups.tag ?? null;
}

function isCommitInChangelog(commit, changelog) {
  if (!changelog) return false;
  return changelog.includes(commit.hash) || changelog.includes(commit.hash.slice(0, 7));
}

function parseCommit(commit) {
  const message = `${commit.subject}\n${commit.body ?? ''}`;
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  let subject = commit.subject;
  let type;
  for (const line of lines) {
    const candidateType = conventionalType(line);
    if (DEFAULT_TYPES.includes(candidateType)) {
      subject = line;
      type = candidateType;
      break;
    }
  }

  const request = parseRequestReference(message);
  if (request) {
    request.title = type
      ? subject
      : lines.find((line) => !parseRequestReference(line) && !/^Merge\b/i.test(line)) ?? null;
  }

  return {
    ...commit,
    subject,
    type,
    isRelease: /^chore\(release\):\s.+/.test(subject),
    request,
  };
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
  const references = [
    shortHash,
    commit.request?.label,
  ].filter(Boolean);
  const suffix = ` (${references.join(', ')})`;
  return `${commit.subject}${suffix}`;
}

function formatRequestEntry(request) {
  return request.title ? `${request.label} ${request.title}` : request.label;
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

function parseRequestReference(message) {
  const gitlabMerge = /(?:^|[\s(])(?:See merge request\s+\S+!|!)(?<number>\d+)(?=\D|$)/i.exec(message);
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

  const httpsMatch = /^https?:\/\/(?<host>[^/]+)\/(?<repo>.+?)(?:\.git)?$/.exec(remote);
  if (httpsMatch) {
    return httpsMatch.groups;
  }

  return null;
}
