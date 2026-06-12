import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('CLI rejects invalid release formats', () => {
  const result = spawnSync(process.execPath, ['bin/calver-bump.js', '--format', 'nope'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid format/);
});

test('CLI prints help', () => {
  const result = spawnSync(process.execPath, ['bin/calver-bump.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: calver-bump/);
  assert.match(result.stdout, /--commit/);
  assert.match(result.stdout, /--tag/);
});

test('CLI rejects unknown options', () => {
  const result = spawnSync(process.execPath, ['bin/calver-bump.js', '--tagprefix', 'v'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option --tagprefix/);
});

test('CLI rejects conflicting write modes', () => {
  const result = spawnSync(process.execPath, ['bin/calver-bump.js', '--version-only', '--changelog-only'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be combined/);
});

test('CLI rejects skip-commit with git action flags', () => {
  const result = spawnSync(process.execPath, ['bin/calver-bump.js', '--skip-commit', '--tag'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--skip-commit cannot be combined/);
});

test('CLI dry-run output includes release audit details', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--dry-run', '--no-fetch'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Changelog range: HEAD/);
  assert.match(result.stdout, /Files: package\.json/);
  assert.match(result.stdout, /Tag fetch: skipped/);
  assert.match(result.stdout, /Planned actions:/);
});

test('CLI does not print push guidance for version-only releases', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--version-only', '--push'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Git tag: \(not created\)/);
  assert.doesNotMatch(result.stdout, /git push --follow-tags/);
});

test('CLI prints manual release commands by default', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Next steps:/);
  assert.match(result.stdout, /git add package\.json CHANGELOG\.md/);
  assert.match(result.stdout, /git commit -m "chore\(release\): 26\.\d{4}"/);
  assert.match(result.stdout, /git tag -a 26\.\d{4} -m "Release 26\.\d{4}"/);
  assert.match(result.stdout, /git push --follow-tags origin main/);
});

test('CLI reads .calverbumprc.json defaults', async () => {
  const repo = await makeRepo();
  await writeFile(
    path.join(repo, '.calverbumprc.json'),
    `${JSON.stringify({ tagPrefix: 'v', types: ['feat'] }, null, 2)}\n`,
  );
  execFileSync('git', ['add', '.calverbumprc.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'chore: add calver bump config'], { cwd: repo });
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Git tag: \(not created\)/);
  const tag = execFileSync('git', ['tag', '--list', 'v26*'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, '');
  const changelog = execFileSync('git', ['status', '--porcelain'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.match(changelog, /M package\.json/);
  assert.match(changelog, /\?\? CHANGELOG\.md/);
});

test('CLI prints and runs push command when --push is enabled', async () => {
  const remote = await makeBareRepo();
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--push'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Running: git push --follow-tags origin main/);
  const remoteTags = execFileSync('git', ['tag', '--list', '26*'], {
    cwd: remote,
    encoding: 'utf8',
  }).trim();
  assert.match(remoteTags, /^26\.\d{4}$/);
});

test('CLI supports --remote with --push', async () => {
  const remote = await makeBareRepo();
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'upstream', remote], { cwd: repo });
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--push', '--remote', 'upstream'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Running: git push --follow-tags upstream main/);
});

test('CLI creates a release commit without a tag when --commit is enabled', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--commit'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /create git commit chore\(release\): 26\.\d{4}/);
  assert.doesNotMatch(result.stdout, /create git tag/);
  assert.match(result.stdout, /git tag -a 26\.\d{4} -m "Release 26\.\d{4}"/);
  const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.match(subject, /^chore\(release\): 26\.\d{4}$/);
});

test('CLI creates a release commit and tag when --tag is enabled', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--tag'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /create git commit chore\(release\): 26\.\d{4}/);
  assert.match(result.stdout, /create git tag 26\.\d{4}/);
  const tag = execFileSync('git', ['tag', '--list', '26*'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.match(tag, /^26\.\d{4}$/);
});

async function makeRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'calver-bump-cli-'));
  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: repo });
  await writeFile(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'demo-app', version: '0.0.0' }, null, 2)}\n`,
  );
  execFileSync('git', ['add', 'package.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: initial app'], { cwd: repo });
  return repo;
}

async function makeBareRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'calver-bump-remote-'));
  execFileSync('git', ['init', '--bare'], { cwd: repo });
  return repo;
}
