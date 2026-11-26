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
  const remoteUrl = await getRemoteUrl(cwd, options.remote ?? 'origin');
  const links = remoteUrl ? buildRepositoryLinks(remoteUrl) : null;
  const commits = (await gitCommits(cwd, range))
    .map((commit) => parseCommit(commit, links))
    .filter((commit) => !commit.isRelease);
  const allowedTypes = options.types ?? DEFAULT_TYPES;
  const conventionalCommits = dedupeConventionalChanges(commits
    .filter((commit) => commit.type && allowedTypes.includes(commit.type))
    .filter((commit) => !isCommitInChangelog(commit, existingChangelog)));
  const requests = uniqueRequests(commits.map((commit) => commit.request).filter(Boolean));
  return {
    previousTag: latestTag,
    range: latestTag ? `${latestTag}..HEAD` : 'HEAD',
    compareUrlBuilder: links?.compareUrl ?? null,
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

function parseCommit(commit, links) {
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
    if (request.provider === links?.provider) {
      request.url = links.requestUrl(request);
    }
  }

  return {
    ...commit,
    subject,
    type,
    url: links?.commitUrl(commit.hash),
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
  const references = [
    formatLinkedLabel(commit.hash.slice(0, 7), commit.url),
    formatLinkedLabel(commit.request?.label, commit.request?.url),
  ].filter(Boolean);
  const suffix = ` (${references.join(', ')})`;
  return `${commit.subject}${suffix}`;
}

function formatRequestEntry(request) {
  const label = formatLinkedLabel(request.label, request.url);
  return request.title ? `${label} ${request.title}` : label;
}

function formatLinkedLabel(label, url) {
  return url ? `[${label}](${url})` : label;
}

function buildRepositoryLinks(remote) {
  const parsed = parseGitRemote(remote);
  if (!parsed) {
    return null;
  }

  const github = parsed.host === 'github.com';
  if (!github && !parsed.host.includes('gitlab')) {
    return null;
  }

  const hostUrl = `https://${parsed.host}`;
  const baseUrl = `${hostUrl}/${parsed.repo}${github ? '' : '/-'}`;
  return {
    provider: github ? 'github' : 'gitlab',
    compareUrl: (from, to) => `${baseUrl}/compare/${from}...${to}`,
    commitUrl: (hash) => `${baseUrl}/commit/${hash}`,
    requestUrl({ number, project }) {
      if (github) {
        return `${baseUrl}/pull/${number}`;
      }
      const repo = project?.replace(/\.git$/, '') ?? parsed.repo;
      if (project && (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(repo) || /(?:^|\/)\.\.?(?:\/|$)/.test(repo))) {
        return null;
      }
      return `${hostUrl}/${repo}/-/merge_requests/${number}`;
    },
  };
}

function parseRequestReference(message) {
  const gitlabMerge = /(?:^|[\s(])(?:See merge request\s+(?<project>\S+)!|!)(?<number>\d+)(?=\D|$)/i.exec(message);
  if (gitlabMerge) {
    const { number, project } = gitlabMerge.groups;
    return { provider: 'gitlab', number, label: `!${number}`, project };
  }

  const githubPull = /(?:Merge pull request\s+#|#)(?<number>\d+)(?=\D|$)/i.exec(message);
  if (githubPull) {
    return { provider: 'github', number: githubPull.groups.number, label: `#${githubPull.groups.number}` };
  }

  return null;
}

function uniqueRequests(requests) {
  const unique = new Map();
  for (const request of requests) {
    const key = request.url ?? `${request.provider}:${request.number}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, request);
    } else if (!existing.title && request.title) {
      existing.title = request.title;
    }
  }
  return [...unique.values()];
}

function parseGitRemote(remote) {
  const sshMatch = /^git@(?<host>[^:]+):(?<repo>.+?)(?:\.git)?$/.exec(remote);
  if (sshMatch) {
    return sshMatch.groups;
  }

  if (!/^https?:\/\//.test(remote)) {
    return null;
  }

  try {
    const { host, pathname } = new URL(remote);
    return pathname.length > 1 ? { host, repo: pathname.slice(1).replace(/\.git$/, '') } : null;
  } catch {
    return null;
  }
}
