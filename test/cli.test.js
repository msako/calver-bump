import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  assert.match(result.stderr, /Unknown option ['"]?--tagprefix/);
});

test('CLI rejects stray arguments before preparing a release', async () => {
  const repo = await makeRepo();
  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), 'skip-commit'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected argument .*skip-commit/);
  assert.equal(await packageVersion(repo), '0.0.0');
  assert.equal(execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf8' }).trim(), '');
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

test('CLI version-only preview fetches remote tags without pruning local tags', async () => {
  const repo = await makeRepo();
  gitOutput(repo, 'remote', 'add', 'origin', await makeBareRepo());
  gitOutput(repo, 'tag', 'published');
  gitOutput(repo, 'push', 'origin', 'main', 'refs/tags/published');
  gitOutput(repo, 'tag', '-d', 'published');
  gitOutput(repo, 'tag', '-a', 'local-unpublished', '-m', 'Local release');
  gitOutput(repo, 'config', 'fetch.prune', 'true');
  gitOutput(repo, 'config', 'fetch.pruneTags', 'true');

  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), '--version-only', '--dry-run'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitOutput(repo, 'tag', '--list'), 'local-unpublished\npublished');
  assert.equal(await packageVersion(repo), '0.0.0');
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
  assert.doesNotMatch(result.stdout, /^git push |^Running: git push /m);
});

test('CLI creates a local release commit and tag by default without a terminal', async () => {
  const remote = await makeBareRepo();
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const version = await packageVersion(repo);
  assert.match(version, /^\d{2}\.\d{4}$/);
  assert.match(result.stdout, /Next steps:/);
  assert.doesNotMatch(result.stdout, /\[y\/N\]|^Running: git push /m);
  assert.ok(result.stdout.includes(`create git commit chore(release): ${version}`));
  assert.ok(result.stdout.includes(`create git tag v${version}`));
  assert.ok(result.stdout.includes(releasePushLine(repo, 'origin', `v${version}`)));
  const tag = execFileSync('git', ['tag', '--list'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, `v${version}`);
  const remoteRefs = execFileSync('git', ['for-each-ref'], {
    cwd: remote,
    encoding: 'utf8',
  });
  assert.equal(remoteRefs, '');
});

test('CLI accepts an empty tag prefix for an unprefixed release tag', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--tag-prefix', ''], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const tag = execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(tag, await packageVersion(repo));
  assert.ok(result.stdout.includes(`Git tag: ${tag}\n`));
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
  const version = await packageVersion(repo);
  assert.ok(result.stdout.includes(`Git tag: v${version}\n`));
  const tag = execFileSync('git', ['tag', '--list'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, `v${version}`);
  const changelog = execFileSync('git', ['status', '--porcelain'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(changelog, '');
});

test('CLI pushes the exact branch and tag despite configured push mappings and tag following', async () => {
  const remote = await makeBareRepo();
  const repo = await makeRepo();
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  execFileSync('git', ['config', 'push.followTags', 'true'], { cwd: repo });
  execFileSync('git', ['config', '--add', 'remote.origin.push', 'refs/heads/main:refs/heads/integration'], { cwd: repo });
  execFileSync('git', ['config', '--add', 'remote.origin.push', 'refs/tags/*:refs/tags/mapped/*'], { cwd: repo });
  execFileSync('git', ['tag', '-a', 'internal-review', '-m', 'Unrelated tag'], { cwd: repo });
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--push'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const version = await packageVersion(repo);
  const remoteTags = execFileSync('git', ['tag', '--list'], {
    cwd: remote,
    encoding: 'utf8',
  }).trim();
  assert.equal(remoteTags, `v${version}`);
  const remoteHead = execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: remote, encoding: 'utf8' });
  assert.equal(remoteHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }));
  const remoteBranches = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remote, encoding: 'utf8' });
  assert.equal(remoteBranches, 'refs/heads/main\n');
  assert.ok(result.stdout.includes(`Running: ${releasePushLine(repo, 'origin', `v${version}`)}`));
});

test('CLI leaves both remote refs unchanged when the release branch push is rejected', async () => {
  const repo = await makeRepo();
  const remote = await makeBareRepo();
  gitOutput(repo, 'remote', 'add', 'origin', remote);
  gitOutput(repo, 'switch', '-c', 'upstream');
  gitOutput(repo, 'commit', '--allow-empty', '-m', 'feat: upstream change');
  gitOutput(repo, 'push', 'origin', 'refs/heads/upstream:refs/heads/main');
  const upstream = gitOutput(repo, 'rev-parse', 'HEAD');
  gitOutput(repo, 'switch', 'main');

  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), '--push', '--no-fetch'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-fast-forward/);
  assert.equal(gitOutput(remote, 'rev-parse', 'refs/heads/main'), upstream);
  assert.equal(gitOutput(remote, 'tag', '--list'), '');
  assert.equal(gitOutput(repo, 'tag', '--list'), `v${await packageVersion(repo)}`);
});

test('CLI confirmation pushes the release objects captured before the refs move', { timeout: 15000 }, async (t) => {
  const repo = await makeRepo();
  const remote = await makeBareRepo();
  gitOutput(repo, 'remote', 'add', 'origin', remote);
  const mockTerminal = `data:text/javascript,${encodeURIComponent('process.stdin.isTTY = process.stdout.isTTY = true;')}`;
  const child = spawn(process.execPath, ['--import', mockTerminal, path.resolve('bin/calver-bump.js'), '--no-fetch'], {
    cwd: repo,
    stdio: 'pipe',
  });
  t.after(() => child.kill());
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });

  let stdout = '';
  let approved;
  for await (const chunk of child.stdout.setEncoding('utf8')) {
    stdout += chunk;
    if (approved || !stdout.includes('[y/N]')) continue;
    const tag = `v${await packageVersion(repo)}`;
    const tagRef = `refs/tags/${tag}`;
    approved = {
      tagRef,
      tagOid: gitOutput(repo, 'rev-parse', tagRef),
      commitOid: gitOutput(repo, 'rev-parse', 'HEAD'),
    };
    gitOutput(repo, 'commit', '--allow-empty', '-m', 'wip: local draft');
    gitOutput(repo, 'tag', '-fa', tag, '-m', 'Replacement tag');
    gitOutput(repo, 'branch', approved.commitOid);
    gitOutput(repo, 'branch', approved.tagOid);
    child.stdin.end('yes\n');
  }

  const [status] = await closed;
  assert.equal(status, 0, stderr);
  assert.ok(approved, stdout);
  assert.equal(gitOutput(remote, 'rev-parse', 'refs/heads/main'), approved.commitOid);
  assert.equal(gitOutput(remote, 'rev-parse', approved.tagRef), approved.tagOid);
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
  const version = await packageVersion(repo);
  assert.ok(result.stdout.includes(`Running: ${releasePushLine(repo, 'upstream', `v${version}`)}`));
});

test('CLI --commit overrides a configured tag action', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, '.calverbumprc.json'), '{"tag":true}\n');
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--commit'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const version = await packageVersion(repo);
  assert.equal(execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf8' }).trim(), '');
  assert.ok(result.stdout.includes(`create git commit chore(release): ${version}`));
  assert.doesNotMatch(result.stdout, /create git tag/);
  assert.ok(result.stdout.includes(`git tag -a v${version} -m 'Release ${version}'`));
  const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, `chore(release): ${version}`);
});

test('CLI creates a release commit and tag when --tag is enabled', async () => {
  const repo = await makeRepo();
  const cliPath = path.resolve('bin/calver-bump.js');

  const result = spawnSync(process.execPath, [cliPath, '--tag'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const version = await packageVersion(repo);
  assert.ok(result.stdout.includes(`create git commit chore(release): ${version}`));
  assert.ok(result.stdout.includes(`create git tag v${version}`));
  const tag = execFileSync('git', ['tag', '--list'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(tag, `v${version}`);
});

test('CLI manual commit commands leave unrelated staged files staged', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'staged.txt'), 'work in progress\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: repo });
  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), '--skip-commit'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const commands = result.stdout.split('\n').filter((line) => /^git (add|commit) /.test(line));
  assert.equal(commands.length, 2);
  execFileSync('/bin/sh', ['-e', '-c', commands.join('\n')], { cwd: repo });
  const committed = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(committed, 'CHANGELOG.md\npackage.json\n');
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }), 'staged.txt\n');
});

test('CLI rejects a detached-HEAD push before writing release files', async () => {
  const repo = await makeRepo();
  execFileSync('git', ['checkout', '--detach'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', await makeBareRepo()], { cwd: repo });
  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), '--push'], {
    cwd: repo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(await packageVersion(repo), '0.0.0');
  assert.match(result.stderr, /detached HEAD/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), '');
});

test('CLI rejects a pending merge in a linked worktree before writing or staging release files', async () => {
  const repo = await makeRepo();
  const linked = path.join(await mkdtemp(path.join(tmpdir(), 'calver-bump-linked-')), 'release');
  gitOutput(repo, 'worktree', 'add', '-b', 'release', linked);
  gitOutput(repo, 'switch', '-c', 'feature');
  await writeFile(path.join(repo, 'feature.txt'), 'new feature\n');
  gitOutput(repo, 'add', 'feature.txt');
  gitOutput(repo, 'commit', '-m', 'feat: add feature');
  gitOutput(linked, 'merge', '--no-ff', '--no-commit', 'feature');
  const before = gitOutput(linked, 'status', '--porcelain');

  const result = spawnSync(process.execPath, [path.resolve('bin/calver-bump.js'), '--no-fetch'], {
    cwd: linked,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(gitOutput(linked, 'status', '--porcelain'), before);
  assert.equal(await packageVersion(linked), '0.0.0');
  assert.match(result.stderr, /merge.*in progress/i);
});

function gitOutput(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function releasePushLine(repo, remote, tag) {
  const commitOid = gitOutput(repo, 'rev-parse', 'HEAD');
  const tagOid = gitOutput(repo, 'rev-parse', `refs/tags/${tag}`);
  return `git push --atomic --no-follow-tags -- ${remote} '${commitOid}^{object}:refs/heads/main' '${tagOid}^{object}:refs/tags/${tag}'`;
}

async function packageVersion(repo) {
  return JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8')).version;
}

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
