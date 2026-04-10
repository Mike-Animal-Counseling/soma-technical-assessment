export type DueStatus = 'none' | 'scheduled' | 'dueSoon' | 'overdue';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function getDueStatus(dueDate: Date | string | null | undefined, now = new Date()): DueStatus {
  if (!dueDate) {
    return 'none';
  }

  const parsed = dueDate instanceof Date ? dueDate : new Date(dueDate);

  if (Number.isNaN(parsed.getTime())) {
    return 'none';
  }

  const diffMs = parsed.getTime() - now.getTime();

  if (diffMs < 0) {
    return 'overdue';
  }

  if (diffMs <= 24 * 60 * 60 * 1000) {
    return 'dueSoon';
  }

  return 'scheduled';
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return 'No date set';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'No date set';
  }

  return dateTimeFormatter.format(date);
}

export function formatDurationHours(hours: number | null | undefined, fallbackHours = 1) {
  const duration =
    typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 ? hours : fallbackHours;
  const wholeHours = Number.isInteger(duration);

  return `${wholeHours ? duration.toFixed(0) : duration.toFixed(1)}h`;
}

export function toDateTimeLocalValue(value: Date | string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const timezoneOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - timezoneOffset * 60 * 1000).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
