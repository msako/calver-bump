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

  assert.equal(plan.version, '26.0529');
  assert.deepEqual(plan.actions, [
    'update package.json version to 26.0529',
    'prepend CHANGELOG.md entry for 26.0529',
    'create git commit chore(release): 26.0529',
    'create git tag 26.0529',
  ]);

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.0.0');
});

test('runRelease supports tag prefixes without changing package.json version', async () => {
  const repo = await makeRepo();

  const result = await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
    tagPrefix: 'v',
  });

  assert.equal(result.version, '26.0529');
  assert.equal(result.tag, 'v26.0529');

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '26.0529');

  const tag = execFileSync('git', ['tag', '--list', 'v26.0529'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, 'v26.0529');
});

test('runRelease updates package.json, prepends changelog, commits, and tags', async () => {
  const repo = await makeRepo();

  const result = await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  assert.equal(result.version, '26.0529');

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '26.0529');

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /^# Changelog\n\n## 26\.0529 - 2026-05-29\n\n### Features\n\n- feat: initial app/);

  const tag = execFileSync('git', ['tag', '--list', '26.0529'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, '26.0529');

  const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, 'chore(release): 26.0529');
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
  assert.equal(lock.version, '26.0529');
  assert.equal(lock.packages[''].version, '26.0529');
});

test('runRelease uses the nearest reachable tag as the changelog base', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', '26.0528.1'], { cwd: repo });
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
  assert.doesNotMatch(changelog, /- feat: after calver tag/);
  assert.doesNotMatch(changelog, /- feat: initial app/);
});

test('runRelease includes only conventional commits in the changelog', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'note.txt'), 'note\n');
  execFileSync('git', ['add', 'note.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'update docs manually'], { cwd: repo });
  await writeFile(path.join(repo, 'fix.txt'), 'fix\n');
  execFileSync('git', ['add', 'fix.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix(release): keep only conventional commits'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /- fix\(release\): keep only conventional commits/);
  assert.match(changelog, /- feat: initial app/);
  assert.doesNotMatch(changelog, /update docs manually/);
});

test('runRelease filters changelog entries by configured conventional commit types', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'fix.txt'), 'fix\n');
  execFileSync('git', ['add', 'fix.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: excluded by type filter'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
    types: ['feat'],
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /- feat: initial app/);
  assert.doesNotMatch(changelog, /fix: excluded by type filter/);
});

test('runRelease groups changelog entries by conventional commit type', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'fix.txt'), 'fix\n');
  execFileSync('git', ['add', 'fix.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix(auth): repair token refresh'], { cwd: repo });
  await writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: add release grouping'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(
    changelog,
    /## 26\.0529 - 2026-05-29\n\n### Features\n\n- feat: add release grouping \([a-f0-9]{7}\)\n- feat: initial app \([a-f0-9]{7}\)\n\n### Fixes\n\n- fix\(auth\): repair token refresh \([a-f0-9]{7}\)/,
  );
});

test('runRelease links each changelog entry to its commit on GitHub', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:msako/demo-app.git'], { cwd: repo });
  execFileSync('git', ['tag', 'v1.0.0'], { cwd: repo });
  await writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: add linked changelog entry'], { cwd: repo });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const shortHash = hash.slice(0, 7);

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(
    changelog,
    new RegExp(`- feat: add linked changelog entry \\(\\[${shortHash}\\]\\(https://github\\.com/msako/demo-app/commit/${hash}\\)\\)`),
  );
  assert.match(
    changelog,
    /^# Changelog\n\n## \[26\.0529\]\(https:\/\/github\.com\/msako\/demo-app\/compare\/v1\.0\.0\.\.\.26\.0529\) - 2026-05-29/,
  );
});

test('runRelease links changelog entries for private GitLab-style remotes', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.internal.example.com:platform/demo-app.git'], { cwd: repo });
  execFileSync('git', ['tag', 'v1.0.0'], { cwd: repo });
  await writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: link private gitlab commit'], { cwd: repo });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const shortHash = hash.slice(0, 7);

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(
    changelog,
    new RegExp(`- fix: link private gitlab commit \\(\\[${shortHash}\\]\\(https://gitlab\\.internal\\.example\\.com/platform/demo-app/-/commit/${hash}\\)\\)`),
  );
  assert.match(
    changelog,
    /^# Changelog\n\n## \[26\.0529\]\(https:\/\/gitlab\.internal\.example\.com\/platform\/demo-app\/-\/compare\/v1\.0\.0\.\.\.26\.0529\) - 2026-05-29/,
  );
});

test('runRelease prepends only commits since the previous CalVer tag on later releases', async () => {
  const repo = await makeRepo();
  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });
  await writeFile(path.join(repo, 'second.txt'), 'second\n');
  execFileSync('git', ['add', 'second.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: second release only'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T13:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  const latestEntry = changelog.split('## 26.0529 - 2026-05-29')[0];
  assert.match(latestEntry, /## 26\.0529\.1 - 2026-05-29/);
  assert.match(latestEntry, /- fix: second release only/);
  assert.doesNotMatch(latestEntry, /feat: initial app/);
});

test('runRelease uses the latest reachable tag as the changelog base even when it is not CalVer', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', 'v2.20'], { cwd: repo });
  await writeFile(path.join(repo, 'later.txt'), 'later\n');
  execFileSync('git', ['add', 'later.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: after legacy version tag'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /- fix: after legacy version tag/);
  assert.doesNotMatch(changelog, /- feat: initial app/);
});

test('runRelease uses the nearest history tag, not the newest-created reachable tag, as the changelog base', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', 'old-tag'], { cwd: repo });
  await writeFile(path.join(repo, 'first.txt'), 'first\n');
  execFileSync('git', ['add', 'first.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: already released'], { cwd: repo });
  execFileSync('git', ['tag', 'v1.35.0'], { cwd: repo });
  execFileSync('git', ['tag', '-f', 'newer-created-old-tag', 'old-tag'], { cwd: repo });
  await writeFile(path.join(repo, 'second.txt'), 'second\n');
  execFileSync('git', ['add', 'second.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: unreleased change'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /- fix: unreleased change/);
  assert.doesNotMatch(changelog, /feat: already released/);
  assert.doesNotMatch(changelog, /feat: initial app/);
});

test('runRelease fetches remote tags before choosing the changelog base', async () => {
  const repo = await makeRepo();
  const remote = await makeBareRepo();
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  await writeFile(path.join(repo, 'released.txt'), 'released\n');
  execFileSync('git', ['add', 'released.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: already in remote tagged release'], { cwd: repo });
  execFileSync('git', ['tag', 'v1.35.0'], { cwd: repo });
  execFileSync('git', ['push', 'origin', 'main', '--tags'], { cwd: repo });
  execFileSync('git', ['tag', '-d', 'v1.35.0'], { cwd: repo });
  await writeFile(
    path.join(repo, 'CHANGELOG.md'),
    '# Changelog\n\n## [1.35.0](https://gitlab.ops/example/repo/compare/v1.34.0...v1.35.0) (2026-06-01)\n\n### Features\n\n* feat: already in remote tagged release\n',
  );
  await writeFile(path.join(repo, 'unreleased.txt'), 'unreleased\n');
  execFileSync('git', ['add', 'CHANGELOG.md', 'unreleased.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: unreleased after remote tag'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-06-02T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  const latestEntry = changelog.split('## [1.35.0]')[0];
  assert.match(latestEntry, /- fix: unreleased after remote tag/);
  assert.doesNotMatch(latestEntry, /feat: already in remote tagged release/);
});

test('runRelease does not duplicate commits already present in an existing changelog', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'released.txt'), 'released\n');
  execFileSync('git', ['add', 'released.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: already documented'], { cwd: repo });
  const documentedHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  await writeFile(
    path.join(repo, 'CHANGELOG.md'),
    `# Changelog\n\n## [1.35.0](https://gitlab.ops/example/repo/compare/v1.34.0...v1.35.0) (2026-06-01)\n\n### Features\n\n* **site-map:** already documented ([${documentedHash.slice(0, 7)}](https://gitlab.ops/example/repo/-/commit/${documentedHash}))\n`,
  );
  await writeFile(path.join(repo, 'unreleased.txt'), 'unreleased\n');
  execFileSync('git', ['add', 'CHANGELOG.md', 'unreleased.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fix: not yet documented'], { cwd: repo });

  await runRelease({
    cwd: repo,
    date: new Date('2026-06-02T12:00:00-07:00'),
  });

  const changelog = await readFile(path.join(repo, 'CHANGELOG.md'), 'utf8');
  const latestEntry = changelog.split('## [1.35.0]')[0];
  assert.match(latestEntry, /- fix: not yet documented/);
  assert.doesNotMatch(latestEntry, /feat: already documented/);
});

test('runRelease rolls back its release commit when tag creation fails', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['tag', '26.0529'], { cwd: repo });
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

test('runRelease can skip commit and tag creation', async () => {
  const repo = await makeRepo();

  const result = await runRelease({
    cwd: repo,
    date: new Date('2026-05-29T12:00:00-07:00'),
    skipCommit: true,
  });

  assert.equal(result.tag, null);
  const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, 'feat: initial app');

  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.match(status, /M package\.json/);
  assert.match(status, /\?\? CHANGELOG\.md/);
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

async function makeBareRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'calver-bump-remote-'));
  execFileSync('git', ['init', '--bare'], { cwd: repo });
  return repo;
}
