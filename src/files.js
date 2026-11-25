import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function prepareVersionFiles(cwd, version) {
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  pkg.version = version;
  const writes = [{ file: 'package.json', contents: `${JSON.stringify(pkg, null, 2)}\n` }];

  for (const file of ['package-lock.json', 'npm-shrinkwrap.json']) {
    let lock;
    try {
      lock = JSON.parse(await readFile(path.join(cwd, file), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    if (typeof lock.version === 'string') {
      lock.version = version;
    }
    if (lock.packages?.[''] && typeof lock.packages[''].version === 'string') {
      lock.packages[''].version = version;
    }

    writes.push({ file, contents: `${JSON.stringify(lock, null, 2)}\n` });
  }
  return writes;
}

export async function writeReleaseFiles(cwd, writes) {
  for (const { file, contents } of writes) {
    await writeFile(path.join(cwd, file), contents);
  }
}

export async function releaseWarnings(cwd, options = {}) {
  if (!options.updatesVersion) {
    return [];
  }
  const warnings = [];
  for (const fileName of ['pnpm-lock.yaml', 'yarn.lock']) {
    if (await fileExists(path.join(cwd, fileName))) {
      warnings.push(`${fileName} detected; calver-bump does not rewrite this lockfile because it does not store the root package version consistently.`);
    }
  }
  return warnings;
}

export async function readChangelog(cwd) {
  try {
    return await readFile(path.join(cwd, 'CHANGELOG.md'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
