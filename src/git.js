import { execFile as execFileCallback } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function git(cwd, args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

export function releaseGitCommands({ version, files, remote, branch, tag }, snapshot) {
  const branchRef = `refs/heads/${branch}`;
  const tagRef = `refs/tags/${tag}`;
  const branchSource = snapshot ? `${snapshot.commitOid}^{object}` : branchRef;
  const tagSource = snapshot ? `${snapshot.tagOid}^{object}` : tagRef;
  return {
    add: ['add', '--', ...files],
    commit: ['commit', '--only', '-m', `chore(release): ${version}`, '--', ...files],
    tag: ['tag', '-a', tag, '-m', `Release ${version}`],
    push: branch === 'HEAD' ? null : [
      'push', '--atomic', '--no-follow-tags', '--', remote,
      `${branchSource}:${branchRef}`, `${tagSource}:${tagRef}`,
    ],
  };
}

export async function releaseSnapshot(cwd, tag) {
  const { stdout: tagObject } = await git(cwd, ['rev-parse', '--verify', '--end-of-options', `refs/tags/${tag}^{tag}`]);
  const tagOid = tagObject.trim();
  const { stdout: commitObject } = await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${tagOid}^{commit}`]);
  return { commitOid: commitObject.trim(), tagOid };
}

export async function gitLines(cwd, args) {
  const { stdout } = await git(cwd, args);
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function gitCommits(cwd, range) {
  const { stdout } = await git(cwd, ['log', '--pretty=format:%H%x00%s%x00%B%x1e', ...range]);
  return stdout
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.replace(/^\n+|\n+$/g, '').split('\0');
      return { hash, subject, body };
    });
}

export async function getRemoteUrl(cwd, remote) {
  try {
    const { stdout } = await git(cwd, ['remote', 'get-url', remote]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function tryFetchTags(cwd, remote) {
  try {
    await git(cwd, ['remote', 'get-url', remote]);
    await git(cwd, ['fetch', '--tags', '--no-prune', '--no-prune-tags', remote]);
  } catch {}
}

export async function currentBranch(cwd) {
  try {
    const { stdout } = await git(cwd, ['branch', '--show-current']);
    return stdout.trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

export async function assertCleanWorktree(cwd) {
  const status = await gitLines(cwd, ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.');
  }
}

export async function assertNoMergeInProgress(cwd) {
  const { stdout } = await git(cwd, ['rev-parse', '--git-path', 'MERGE_HEAD']);
  try {
    await lstat(resolve(cwd, stdout.trimEnd()));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw new Error('A Git merge is in progress. Finish or abort the merge before creating a release commit.');
}

export async function tagExists(cwd, tag) {
  try {
    await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{}`]);
    return true;
  } catch {
    return false;
  }
}

export async function assertTagAvailable(cwd, tag) {
  if (await tagExists(cwd, tag)) {
    throw new Error(`Git tag ${tag} already exists. Choose another date/format or delete the existing tag before releasing.`);
  }
}

export async function latestReachableTag(cwd) {
  try {
    const { stdout } = await git(cwd, ['describe', '--tags', '--abbrev=0']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
