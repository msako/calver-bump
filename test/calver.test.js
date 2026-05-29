import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextCalVer } from '../src/calver.js';

test('nextCalVer defaults to readable dotted format YYYY.MM.DD.N', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: [],
  });

  assert.equal(version, '2026.05.29.1');
});

test('nextCalVer increments the sequence for existing tags on the same day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['2026.05.28.7', '2026.05.29.1', 'v2026.05.29.2'],
  });

  assert.equal(version, '2026.05.29.3');
});

test('nextCalVer can emit compact YYYYMMDD.N when requested', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['20260529.1'],
    format: 'compact',
  });

  assert.equal(version, '20260529.2');
});
