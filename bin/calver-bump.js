#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { runRelease } from '../src/index.js';
import { assertFormat } from '../src/calver.js';

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);

try {
  const options = await releaseOptions(args);
  assertFormat(options.format);
  const result = await runRelease(options);
  console.log(`Release version: ${result.version}`);
  for (const action of result.actions) {
    console.log(`- ${action}`);
  }
  if (options.push && !options.dryRun) {
    const pushArgs = ['push', '--follow-tags', result.remote, result.branch];
    console.log('');
    console.log(`Running: git ${pushArgs.join(' ')}`);
    await execFile('git', pushArgs, { encoding: 'utf8' });
  } else if (!options.dryRun && !options.skipCommit) {
    console.log('');
    console.log('Next steps:');
    console.log('1. Review the release commit:');
    console.log('   git show --stat HEAD');
    console.log('2. Push the release commit and tag:');
    console.log(`   git push --follow-tags ${result.remote} ${result.branch}`);
    console.log('3. Trigger or verify your deployment pipeline.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function releaseOptions(args) {
  const config = await readConfig();
  return {
    ...config,
    dryRun: flag(args, '--dry-run') ?? config.dryRun ?? false,
    push: flag(args, '--push') ?? config.push ?? false,
    skipCommit: flag(args, '--skip-commit') ?? config.skipCommit ?? false,
    format: value(args, '--format') ?? config.format ?? 'short',
    remote: value(args, '--remote') ?? config.remote ?? 'origin',
    tagPrefix: value(args, '--tag-prefix') ?? config.tagPrefix ?? '',
    types: parseTypes(value(args, '--types')) ?? config.types,
  };
}

async function readConfig() {
  try {
    return JSON.parse(await readFile('.calverbumprc.json', 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function flag(args, name) {
  return args.includes(name) ? true : undefined;
}

function value(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const found = args[index + 1];
  if (!found || found.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return found;
}

function parseTypes(types) {
  return types?.split(',').map((type) => type.trim()).filter(Boolean);
}
