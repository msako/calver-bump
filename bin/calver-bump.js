#!/usr/bin/env node
import { runRelease } from '../src/index.js';
import { assertFormat } from '../src/calver.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'dotted';

try {
  assertFormat(format);
  const result = await runRelease({ dryRun, format });
  console.log(`Release version: ${result.version}`);
  for (const action of result.actions) {
    console.log(`- ${action}`);
  }
  if (!dryRun) {
    console.log('');
    console.log('Next steps:');
    console.log('1. Review the release commit:');
    console.log('   git show --stat HEAD');
    console.log('2. Push the release commit and tag:');
    console.log(`   git push --follow-tags origin ${result.branch}`);
    console.log('3. Trigger or verify your deployment pipeline.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
