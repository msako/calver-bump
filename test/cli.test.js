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

test('CLI explains how to push the release commit and tag after a real release', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Next steps:/);
  assert.match(result.stdout, /git push --follow-tags origin main/);
});

async function makeRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'calver-bump-cli-'));
  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'demo-app', version: '0.0.0' }, null, 2)}\n`,
  );
  execFileSync('git', ['add', 'package.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: initial app'], { cwd: repo });
  return repo;
}
