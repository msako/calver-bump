#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { runRelease } from '../src/index.js';
import { assertFormat } from '../src/calver.js';

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const KNOWN_OPTIONS = new Set([
  '--changelog-only',
  '--dry-run',
  '--format',
  '--from',
  '--help',
  '--no-fetch',
  '--push',
  '--remote',
  '--skip-commit',
  '--tag-prefix',
  '--types',
  '--version',
  '--version-only',
]);

try {
  if (flag(args, '--help')) {
    console.log(helpText());
    process.exit(0);
  }
  if (flag(args, '--version')) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
  }

  const options = await releaseOptions(args);
  assertFormat(options.format);
  const result = await runRelease(options);
  printResult(result, options);
  if (result.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
  for (const action of result.actions) {
    console.log(`- ${action}`);
  }
  if (options.push && !options.dryRun && createsGitObjects(options)) {
    const pushArgs = ['push', '--follow-tags', result.remote, result.branch];
    console.log('');
    console.log(`Running: git ${pushArgs.join(' ')}`);
    await execFile('git', pushArgs, { encoding: 'utf8' });
  } else if (!options.dryRun && createsGitObjects(options)) {
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
  rejectUnknownOptions(args);
  const config = await readConfig();
  const versionOnly = flag(args, '--version-only') ?? config.versionOnly ?? false;
  const changelogOnly = flag(args, '--changelog-only') ?? config.changelogOnly ?? false;
  if (versionOnly && changelogOnly) {
    throw new Error('--version-only cannot be combined with --changelog-only.');
  }
  return {
    ...config,
    dryRun: flag(args, '--dry-run') ?? config.dryRun ?? false,
    noFetch: flag(args, '--no-fetch') ?? config.noFetch ?? false,
    push: flag(args, '--push') ?? config.push ?? false,
    skipCommit: flag(args, '--skip-commit') ?? config.skipCommit ?? false,
    versionOnly,
    changelogOnly,
    from: value(args, '--from') ?? config.from,
    format: value(args, '--format') ?? config.format ?? 'short',
    remote: value(args, '--remote') ?? config.remote ?? 'origin',
    tagPrefix: value(args, '--tag-prefix') ?? config.tagPrefix ?? '',
    types: parseTypes(value(args, '--types')) ?? config.types,
    changelogSections: config.changelogSections,
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

function rejectUnknownOptions(args) {
  for (const arg of args) {
    if (arg.startsWith('--') && !KNOWN_OPTIONS.has(arg)) {
      throw new Error(`Unknown option ${arg}. Run calver-bump --help for usage.`);
    }
  }
}

function printResult(result, options) {
  console.log(`Release version: ${result.version}`);
  console.log(`Git tag: ${createsGitObjects(options) ? result.tag : '(not created)'}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Remote: ${result.remote}`);
  if (!options.versionOnly) {
    console.log(`Changelog range: ${result.range}`);
    console.log(`Previous tag: ${result.previousTag ?? '(none)'}`);
  }
  if (result.files.length > 0) {
    console.log(`Files: ${result.files.join(', ')}`);
  }
  if (options.noFetch) {
    console.log('Tag fetch: skipped (--no-fetch)');
  }
  console.log('');
  console.log(options.dryRun ? 'Planned actions:' : 'Completed actions:');
}

function createsGitObjects(options) {
  return !options.skipCommit && !options.versionOnly && !options.changelogOnly;
}

function helpText() {
  return `Usage: calver-bump [options]

Options:
  --dry-run              Preview the release without writing files.
  --format <name>        Version format: short, compact, or long.
  --tag-prefix <prefix>  Prefix the git tag without changing package.json.
  --types <list>         Comma-separated conventional commit types to include.
  --from <tag>           Use an explicit changelog base tag.
  --no-fetch             Use local tags only; do not fetch remote tags.
  --version-only         Update package.json and supported npm lockfiles only.
  --changelog-only       Update CHANGELOG.md only.
  --skip-commit          Update files without creating a release commit or tag.
  --push                 Push the release commit and annotated tag.
  --remote <name>        Remote used for fetch, links, and push.
  --version              Print the calver-bump package version.
  --help                 Show this help.

Configuration:
  Project defaults can be stored in .calverbumprc.json.`;
}
