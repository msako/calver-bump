export function nextCalVer({ date = new Date(), existingTags = [], format = 'short' } = {}) {
  assertFormat(format);
  const parts = dateParts(date);
  const prefix = calVerPrefix(parts, format);
  const matcher = new RegExp(`^v?${escapeRegExp(prefix)}(?:\\.(\\d+))?$`);
  const releaseState = existingTags.reduce((state, tag) => {
    const match = matcher.exec(tag.trim());
    if (!match) return state;
    return {
      hasBase: state.hasBase || !match[1],
      highestSequence: match[1] ? Math.max(state.highestSequence, Number(match[1])) : state.highestSequence,
    };
  }, { hasBase: false, highestSequence: 0 });

  if (!releaseState.hasBase && releaseState.highestSequence === 0) {
    return prefix;
  }
  return `${prefix}.${releaseState.highestSequence + 1}`;
}

export function assertFormat(format) {
  if (!['short', 'compact', 'long'].includes(format)) {
    throw new Error(`Invalid format "${format}". Expected "short", "compact", or "long".`);
  }
}

export function isCalVerTag(tag) {
  return /^v?\d{2}\.\d{4}(?:\.\d+)?$/.test(tag)
    || /^v?\d{6}(?:\.\d+)?$/.test(tag)
    || /^v?\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(tag)
    || /^v?\d{8}(?:\.\d+)?$/.test(tag);
}

export function isoDate(date = new Date()) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(date) {
  const year = String(date.getFullYear());
  const shortYear = year.slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { year, shortYear, month, day };
}

function calVerPrefix(parts, format) {
  if (format === 'compact') {
    return `${parts.shortYear}${parts.month}${parts.day}`;
  }
  if (format === 'long') {
    return `${parts.year}.${parts.month}.${parts.day}`;
  }
  return `${parts.shortYear}.${parts.month}${parts.day}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
