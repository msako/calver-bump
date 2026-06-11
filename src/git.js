import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function git(cwd, args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
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

export async function fetchTags(cwd, remote) {
  try {
    await git(cwd, ['remote', 'get-url', remote]);
    await git(cwd, ['fetch', '--tags', remote]);
  } catch {
    // Local/offline repos can still release using tags already present.
  }
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
