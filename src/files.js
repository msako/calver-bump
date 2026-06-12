import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function updatePackageVersion(cwd, version) {
  const packagePath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.version = version;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

export async function updatePackageLock(cwd, version) {
  for (const fileName of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const filePath = path.join(cwd, fileName);
    let lock;
    try {
      lock = JSON.parse(await readFile(filePath, 'utf8'));
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

    await writeFile(filePath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

export async function releaseFiles(cwd, options = {}) {
  const candidates = [];
  const files = [];
  if (options.version !== false) {
    candidates.push('package.json', 'package-lock.json', 'npm-shrinkwrap.json');
  }
  for (const candidate of candidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      files.push(candidate);
    }
  }
  if (options.changelog !== false) {
    files.push('CHANGELOG.md');
  }
  return files;
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

export async function writeChangelog(cwd, body) {
  await writeFile(path.join(cwd, 'CHANGELOG.md'), body);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
