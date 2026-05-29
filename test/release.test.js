import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

import { planRelease, runRelease } from '../src/index.js';

test('planRelease reports version, changelog, commit, and tag actions without writing in dry-run mode', async () => {
  const repo = await makeRepo();

  const plan = await planRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
    dryRun: true,
  });

  assert.equal(plan.version, '2026.05.29.1');
  assert.deepEqual(plan.actions, [
    'update package.json version to 2026.05.29.1',
    'prepend CHANGELOG.md entry for 2026.05.29.1',
    'create git commit chore(release): 2026.05.29.1',
    'create git tag 2026.05.29.1',
  ]);

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.0.0');
});

test('runRelease updates package.json, prepends changelog, commits, and tags', async () => {
  const repo = await makeRepo();

  const result = await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  assert.equal(result.version, '2026.05.29.1');

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2026.05.29.1');

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /^# Changelog\n\n## 2026\.05\.29\.1 - 2026-05-29\n\n- feat: initial app/);

  const tag = execFileSync('git', ['tag', '--list', '2026.05.29.1'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, '2026.05.29.1');

  const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, 'chore(release): 2026.05.29.1');
});

test('runRelease returns the current branch for push guidance', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['checkout', '-b', 'release/train'], { cwd: repo });

  const result = await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  assert.equal(result.branch, 'release/train');
});

test('runRelease updates package-lock.json when it exists', async () => {
  const repo = await makeRepo({ packageLock: true });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const lock = JSON.parse(await readFile(path.join(repo, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '2026.05.29.1');
  assert.equal(lock.packages[''].version, '2026.05.29.1');
});

test('runRelease uses the latest CalVer tag as the changelog base and ignores other tags', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', '2026.05.28.1'], { cwd: repo });
  await writeFile(path.join(repo, 'feature-a.txt'), 'a\n');
  execFileSync('git', ['add', 'feature-a.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: after calver tag'], { cwd: repo });
  execFileSync('git', ['tag', 'deploy-preview'], { cwd: repo });
  await writeFile(path.join(repo, 'feature-b.txt'), 'b\n');
  execFileSync('git', ['add', 'feature-b.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: after non-release tag'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /- fix: after non-release tag/);
  assert.match(changelog, /- feat: after calver tag/);
  assert.doesNotMatch(changelog, /- feat: initial app/);
});

test('runRelease rolls back its release commit when tag creation fails', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', '2026.05.29.1'], { cwd: repo });
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  await assert.rejects(
    () => runRelease({
      cwd: repo,
      date: new Date('2026-05-29T12:00:00-07:00'),
      existingTags: [],
    }),
    /Failed to create git tag/,
  );

  const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(after, before);
});

async function makeRepo({ packageLock = false } = {}) {
  const repo = await mkdtemp(path.join(tmpdir(), 'calver-bump-'));
  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: repo });
  await writeFile(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'demo-app', version: '0.0.0' }, null, 2)}\n`,
  );
  if (packageLock) {
    await writeFile(
      path.join(repo, 'package-lock.json'),
      `${JSON.stringify({
        name: 'demo-app',
        version: '0.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'demo-app',
            version: '0.0.0',
          },
        },
      }, null, 2)}\n`,
    );
  }
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: initial app'], { cwd: repo });
  return repo;
}
