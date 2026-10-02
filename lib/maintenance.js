// Pure machine-maintenance schedule logic, from the RNM and C "Monitoring Guide"
// for the refilling station. Isomorphic. Mirrors
// anchor-drops-system/src/domain/maintenance.ts 1:1 — change both.
//
// All dates are Asia/Manila calendar days. PHT is a fixed UTC+8 with no DST, so
// a day number is plain integer math — no Intl / timezone database needed.

const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000;

/** A task this many days out (or closer) is flagged "due soon". */
export const DUE_SOON_DAYS = 7;

export const TIER_LABELS = {
  standard: '500 gal/day',
  high: '750–1,000 gal/day',
};

// Intervals per the guide's two production tiers (months counted as 30 days).
// `high` takes the conservative end of the guide's ranges (post filter 15–25
// days, product filter 3–4 months). The guide also says the real interval
// "depends on the source, prescribed by the technician" — so these are only
// starting presets; every interval is editable per machine.
export const MAINTENANCE_TASKS = [
  // The three media filters share the guide's backwash interval but are tracked
  // (and can be re-timed) separately.
  { key: 'backwash_multimedia', name: 'Backwash multi-media filter', days: { standard: 7, high: 3 } },
  { key: 'backwash_carbon', name: 'Backwash activated carbon filter', days: { standard: 7, high: 3 } },
  { key: 'backwash_softener', name: 'Backwash softener', days: { standard: 7, high: 3 } },
  { key: 'post_filter', name: 'Replace post filters', days: { standard: 30, high: 15 } },
  { key: 'product_filter', name: 'Replace product filters', days: { standard: 150, high: 90 } },
  { key: 'raw_tank', name: 'Clean raw tank', days: { standard: 180, high: 180 } },
  { key: 'product_tank', name: 'Clean product tank', days: { standard: 365, high: 365 } },
];

/** Shown above every backwash checklist. */
export const BACKWASH_WARNING = 'Never process water while backwashing — do NOT turn on the R.O. pump.';

const BACKWASH_START = {
  title: 'Before you start',
  steps: [
    'Make sure there is enough water in the raw tank.',
    'Close the valve located after the softener.',
    'Turn on the RAW PUMP to start backwashing.',
  ],
};

// Multi-media and activated carbon use the same procedure in the guide. The last
// step is the guide's closing step for the whole session (softener step 7), repeated
// here because each filter can now be backwashed on its own day.
const MEDIA_FILTER_STEPS = [
  'Turn the control valve clockwise to BACKWASH — at least 5 minutes, or until the water runs clear.',
  'Turn the control valve counter-clockwise to FAST RINSE — at least 5 minutes.',
  'Turn the control valve counter-clockwise to the SERVICE position.',
  'When you are done backwashing, open the valve located before the post filter — it must be open for production.',
];

/** Read-only procedure per backwash task_key, shown when logging that backwash. */
export const BACKWASH_GUIDES = {
  backwash_multimedia: [BACKWASH_START, { title: 'Multi-media filter', steps: MEDIA_FILTER_STEPS }],
  backwash_carbon: [BACKWASH_START, { title: 'Activated carbon filter', steps: MEDIA_FILTER_STEPS }],
  backwash_softener: [
    BACKWASH_START,
    {
      title: 'Softener',
      steps: [
        'Put 6 kilos of industrial salt into the brine tank and mix until dissolved.',
        'Turn the control valve clockwise to BACKWASH — at least 5 minutes, or until the water runs clear.',
        'Turn clockwise to BRINE SLOW — wait until the brine tank is almost empty.',
        'Turn clockwise to BRINE REFILL — wait until the water reaches 3/4 of the brine tank.',
        'Turn clockwise to FAST RINSE — at least 15 minutes.',
        'Turn clockwise to FILTER to finish.',
        'Open the valve located before the post filter. The machine is ready for production.',
      ],
    },
  ],
};

/** Asia/Manila calendar day as an integer day number. */
export function manilaDay(ms) {
  return Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS);
}

/** Day number → 'YYYY-MM-DD'. */
export function dayToDate(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today's (or `ms`'s) Asia/Manila date as 'YYYY-MM-DD'. */
export function manilaDateString(ms = Date.now()) {
  return dayToDate(manilaDay(ms));
}

/**
 * Next due = last done + interval. A task that was never logged (or whose last
 * timestamp is unreadable) is due today, so a fresh schedule nags until the
 * owner enters when it was last done.
 * Returns { lastDone, nextDue, daysUntil, status: 'overdue'|'today'|'soon'|'good' }.
 */
export function computeTaskDue(lastPerformedAt, intervalDays, now = Date.now()) {
  const today = manilaDay(now);
  const lastMs = lastPerformedAt ? Date.parse(lastPerformedAt) : NaN;
  const lastDay = Number.isFinite(lastMs) ? manilaDay(lastMs) : null;
  const nextDay = lastDay === null ? today : lastDay + intervalDays;
  const daysUntil = nextDay - today;
  const status =
    daysUntil < 0 ? 'overdue' : daysUntil === 0 ? 'today' : daysUntil <= DUE_SOON_DAYS ? 'soon' : 'good';
  return {
    lastDone: lastDay === null ? null : dayToDate(lastDay),
    nextDue: dayToDate(nextDay),
    daysUntil,
    status,
  };
}

/** Most urgent first — for sorting tasks and picking a machine's badge. */
export const DUE_STATUS_RANK = { overdue: 0, today: 1, soon: 2, good: 3 };

/** Latest log per schedule_id (by performed_at). Order-independent; unlinked logs are ignored. */
export function latestBySchedule(logs) {
  const map = new Map();
  for (const log of logs) {
    if (!log.schedule_id) continue;
    const prev = map.get(log.schedule_id);
    if (!prev || Date.parse(log.performed_at) > Date.parse(prev.performed_at)) map.set(log.schedule_id, log);
  }
  return map;
}

/** 'YYYY-MM-DD' → PHT day number, or null if malformed or impossible (Feb 31). */
function parseDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  if (!m) return null;
  const day = manilaDay(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4)); // 04:00 UTC = noon PHT
  return dayToDate(day) === m[0] ? day : null;
}

/**
 * Turn the "date done" a user entered ('YYYY-MM-DD', PHT) into the performed_at
 * timestamp to store. Today → the current instant; an earlier day → noon PHT of
 * that day. Returns null for a malformed, impossible (Feb 31) or future date.
 */
export function performedAtFromDate(date, now = Date.now()) {
  const day = parseDay(date);
  if (day === null) return null;
  const today = manilaDay(now);
  if (day > today) return null;
  return new Date(day === today ? now : day * DAY_MS + 4 * 3_600_000).toISOString();
}

/**
 * Move a 'YYYY-MM-DD' date by whole days for the −/+ day buttons. Never goes past
 * today; an unreadable date snaps to today.
 */
export function shiftDate(date, days, now = Date.now()) {
  const today = manilaDay(now);
  const day = parseDay(date);
  return dayToDate(day === null ? today : Math.min(day + days, today));
}

/** Parse an interval typed by the user; null unless a whole number of days in 1..3650 (the DB CHECK). */
export function parseIntervalDays(input) {
  const text = String(input ?? '').trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 3650 ? n : null;
}

/** Short human label for a task's due state. */
export function dueLabel(due) {
  if (due.lastDone === null) return 'Not yet logged';
  if (due.status === 'overdue') return `Overdue ${-due.daysUntil}d`;
  if (due.status === 'today') return 'Due today';
  if (due.daysUntil === 1) return 'Due tomorrow';
  return `Due in ${due.daysUntil}d`;
}
