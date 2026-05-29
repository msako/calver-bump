export function nextCalVer({ date = new Date(), existingTags = [], format = 'dotted' } = {}) {
  assertFormat(format);
  const parts = dateParts(date);
  const prefix = format === 'compact'
    ? `${parts.year}${parts.month}${parts.day}`
    : `${parts.year}.${parts.month}.${parts.day}`;
  const matcher = new RegExp(`^v?${escapeRegExp(prefix)}\\.(\\d+)$`);
  const highest = existingTags.reduce((max, tag) => {
    const match = matcher.exec(tag.trim());
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `${prefix}.${highest + 1}`;
}

export function assertFormat(format) {
  if (!['dotted', 'compact'].includes(format)) {
    throw new Error(`Invalid format "${format}". Expected "dotted" or "compact".`);
  }
}

export function isCalVerTag(tag) {
  return /^v?\d{4}\.\d{2}\.\d{2}\.\d+$/.test(tag) || /^v?\d{8}\.\d+$/.test(tag);
}

export function isoDate(date = new Date()) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { year, month, day };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
