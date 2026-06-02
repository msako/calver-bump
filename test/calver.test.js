import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextCalVer } from '../src/calver.js';

test('nextCalVer defaults to readable YY.MMDD format for the first release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: [],
  });

  assert.equal(version, '26.0529');
});

test('nextCalVer increments the sequence for existing tags on the same day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['26.0528.7', '26.0529', 'v26.0529.2'],
  });

  assert.equal(version, '26.0529.3');
});

test('nextCalVer emits .1 for the second release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['26.0529'],
  });

  assert.equal(version, '26.0529.1');
});

test('nextCalVer can emit compact YYMMDD without sequence for the first release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    format: 'compact',
  });

  assert.equal(version, '260529');
});

test('nextCalVer can emit compact YYMMDD.N after the first release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['260529'],
    format: 'compact',
  });

  assert.equal(version, '260529.1');
});

test('nextCalVer can emit long YYYY.MM.DD without sequence for the first release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    format: 'long',
  });

  assert.equal(version, '2026.05.29');
});

test('nextCalVer can emit long YYYY.MM.DD.N after the first release of the day', () => {
  const version = nextCalVer({
    date: new Date('2026-05-29T12:00:00-07:00'),
    existingTags: ['2026.05.29'],
    format: 'long',
  });

  assert.equal(version, '2026.05.29.1');
});
