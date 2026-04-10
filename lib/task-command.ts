import type { TaskRecord } from '@/lib/task-types';

interface ParsedTaskCommand {
  title: string;
  dueDate: string | null;
  estimatedDurationHours: number | null;
  dependencyIds: number[];
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function setPlannerDueTime(date: Date) {
  const next = new Date(date);
  next.setHours(17, 0, 0, 0);
  return next;
}

function parseDueToken(token: string, now: Date) {
  const normalized = token.toLowerCase();

  if (normalized === 'today') {
    return setPlannerDueTime(now);
  }

  if (normalized === 'tomorrow') {
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    return setPlannerDueTime(next);
  }

  if (normalized in WEEKDAY_INDEX) {
    const targetDay = WEEKDAY_INDEX[normalized];
    const next = new Date(now);
    const dayDelta = (targetDay - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + dayDelta);
    return setPlannerDueTime(next);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const next = new Date(`${normalized}T17:00:00`);
    return Number.isNaN(next.getTime()) ? null : next;
  }

  if (/^\d{1,2}\/\d{1,2}$/.test(normalized)) {
    const [month, day] = normalized.split('/').map(Number);
    const next = new Date(now.getFullYear(), month - 1, day, 17, 0, 0, 0);

    if (Number.isNaN(next.getTime())) {
      return null;
    }

    if (next.getTime() < now.getTime()) {
      next.setFullYear(now.getFullYear() + 1);
    }

    return next;
  }

  return null;
}

function parseDurationToken(token: string) {
  const match = token.match(/^!(\d+(?:\.\d+)?)(h|m)$/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return unit === 'm' ? Number((value / 60).toFixed(2)) : value;
}

export function parseTaskCommand(
  input: string,
  tasks: TaskRecord[],
  now = new Date(),
): ParsedTaskCommand {
  const dependencySet = new Set<number>();
  let parsedDueDate: string | null = null;
  let parsedDuration: number | null = null;

  input.split(/\s+/).forEach((token) => {
    if (!token) {
      return;
    }

    if (token.startsWith('#')) {
      const taskId = Number(token.slice(1));

      if (Number.isInteger(taskId) && tasks.some((task) => task.id === taskId)) {
        dependencySet.add(taskId);
      }

      return;
    }

    if (token.startsWith('@')) {
      const parsedDate = parseDueToken(token.slice(1), now);

      if (parsedDate) {
        parsedDueDate = parsedDate.toISOString();
      }

      return;
    }

    if (token.startsWith('!')) {
      const duration = parseDurationToken(token);

      if (duration) {
        parsedDuration = duration;
      }
    }
  });

  const title = input
    .replace(/(^|\s)#[0-9]+\b/g, ' ')
    .replace(/(^|\s)![0-9]+(?:\.[0-9]+)?[hm]\b/gi, ' ')
    .replace(/(^|\s)@[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    dueDate: parsedDueDate,
    estimatedDurationHours: parsedDuration,
    dependencyIds: Array.from(dependencySet),
  };
}
