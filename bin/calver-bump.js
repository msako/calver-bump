#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { runRelease } from '../src/index.js';
import { assertFormat } from '../src/calver.js';
import { getRemoteUrl, git, releaseGitCommands } from '../src/git.js';

const OPTIONS = {
  'changelog-only': { type: 'boolean' },
  commit: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  format: { type: 'string' },
  from: { type: 'string' },
  help: { type: 'boolean' },
  'no-fetch': { type: 'boolean' },
  push: { type: 'boolean' },
  remote: { type: 'string' },
  'skip-commit': { type: 'boolean' },
  tag: { type: 'boolean' },
  'tag-prefix': { type: 'string' },
  types: { type: 'string' },
  version: { type: 'boolean' },
  'version-only': { type: 'boolean' },
};

try {
  const { values: flags } = parseArgs({ options: OPTIONS });
  if (flags.help) {
    console.log(helpText());
    process.exit(0);
  }
  if (flags.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
  }

  const options = await releaseOptions(flags);
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
  if (!options.dryRun) {
    const commands = releaseGitCommands(result);
    console.log('');
    const shouldPush = result.createdTag && commands.push && (
      options.push || (
        process.stdin.isTTY && process.stdout.isTTY &&
        await getRemoteUrl(process.cwd(), result.remote) &&
        await confirmPush(result)
      )
    );
    if (shouldPush) {
      console.log(`Running: ${formatGitCommand(commands.push)}`);
      await git(process.cwd(), commands.push);
    } else {
      console.log('Next steps:');
      for (const instruction of nextStepInstructions(result, options, commands)) {
        console.log(instruction);
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function confirmPush({ branch, createdTag, remote }) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const cancel = () => {
      console.log('');
      resolve(false);
    };
    terminal.once('close', cancel);
    terminal.once('SIGINT', () => terminal.close());
    terminal.question(`Push ${branch} and ${createdTag} to ${remote}? [y/N] `, (answer) => {
      terminal.off('close', cancel);
      terminal.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}

async function releaseOptions(flags) {
  for (const [name, value] of Object.entries(flags)) {
    if (value === '' && name !== 'tag-prefix') {
      throw new Error(`--${name} requires a value.`);
    }
  }
  const config = await readConfig();
  const versionOnly = flags['version-only'] ?? config.versionOnly ?? false;
  const changelogOnly = flags['changelog-only'] ?? config.changelogOnly ?? false;
  if (versionOnly && changelogOnly) {
    throw new Error('--version-only cannot be combined with --changelog-only.');
  }
  const requestedAction = gitAction({ ...flags, skipCommit: flags['skip-commit'] });
  const selectedAction = requestedAction ?? gitAction(config) ?? 'tag';
  const action = versionOnly || changelogOnly ? 'none' : selectedAction;
  return {
    dryRun: flags['dry-run'] ?? config.dryRun ?? false,
    noFetch: flags['no-fetch'] ?? config.noFetch ?? false,
    commit: action === 'commit',
    tag: action === 'tag',
    push: action === 'push',
    versionOnly,
    changelogOnly,
    from: flags.from ?? config.from,
    format: flags.format ?? config.format ?? 'short',
    remote: flags.remote ?? config.remote ?? 'origin',
    tagPrefix: flags['tag-prefix'] ?? config.tagPrefix ?? 'v',
    types: flags.types?.split(',').map((type) => type.trim()).filter(Boolean) ?? config.types,
    changelogSections: config.changelogSections,
  };
}

function gitAction({ skipCommit, push, tag, commit }) {
  if (skipCommit) {
    if (push || tag || commit) {
      throw new Error('--skip-commit cannot be combined with --commit, --tag, or --push.');
    }
    return 'none';
  }
  if (push) return 'push';
  if (tag) return 'tag';
  if (commit) return 'commit';
  return tag === false ? 'none' : undefined;
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

function printResult(result, options) {
  console.log(`Release version: ${result.version}`);
  console.log(`Git tag: ${result.createdTag ?? '(not created)'}`);
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

function formatGitCommand(args) {
  const shellArgs = args.map((arg) => /^[\w./:+=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);
  return `git ${shellArgs.join(' ')}`;
}

function nextStepInstructions(result, options, commands) {
  if (options.versionOnly || options.changelogOnly) {
    return ['Review the generated file changes.'];
  }
  const push = commands.push
    ? formatGitCommand(commands.push)
    : 'Put the release commit on a branch before pushing.';
  if (!result.createdTag && !options.commit) {
    return [
      'Review CHANGELOG.md, then run:',
      formatGitCommand(commands.add),
      formatGitCommand(commands.commit),
      formatGitCommand(commands.tag),
      push,
    ];
  }
  if (!result.createdTag) {
    return [
      'Review the release commit, then run:',
      'git show --stat HEAD',
      formatGitCommand(commands.tag),
      push,
    ];
  }
  return [
    'Review the release commit:',
    'git show --stat HEAD',
    'Push the release commit and tag:',
    push,
    'Trigger or verify your deployment pipeline.',
  ];
}

function helpText() {
  return `Usage: calver-bump [options]

Options:
  --dry-run              Preview the release without writing files.
  --format <name>        Version format: short, compact, or long.
  --tag-prefix <prefix>  Prefix the git tag without changing package.json (default: v).
  --types <list>         Comma-separated conventional commit types to include.
  --from <tag>           Use an explicit changelog base tag.
  --no-fetch             Use local tags only; do not fetch remote tags.
  --version-only         Update package.json and supported npm lockfiles only.
  --changelog-only       Update CHANGELOG.md only.
  --commit               Create the release commit after updating files.
  --tag                  Create the release commit and annotated tag.
  --skip-commit          Explicitly update files without creating a release commit or tag.
  --push                 Create, tag, and push the release without asking.
  --remote <name>        Remote used for fetch, links, and push.
  --version              Print the calver-bump package version.
  --help                 Show this help.

After creating a tag on a branch, calver-bump asks whether to push when
stdin and stdout are terminals and the remote is configured.

Configuration:
  Project defaults can be stored in .calverbumprc.json.`;
}
