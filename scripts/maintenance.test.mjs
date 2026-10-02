// Same cases as anchor-drops-system/src/domain/__tests__/maintenance.test.ts.
import assert from 'node:assert/strict';
import {
  MAINTENANCE_TASKS, computeTaskDue, dueLabel, latestBySchedule,
  manilaDateString, parseIntervalDays, performedAtFromDate,
} from '../lib/maintenance.js';

// Fixed "now": 2026-10-01 09:00 PHT (01:00 UTC).
const NOW = Date.UTC(2026, 9, 1, 1);
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// guide defaults for both production tiers
assert.deepEqual(MAINTENANCE_TASKS.map((t) => [t.key, t.days.standard, t.days.high]), [
  ['backwash', 7, 3],
  ['post_filter', 30, 15],
  ['product_filter', 150, 90],
  ['raw_tank', 180, 180],
  ['product_tank', 365, 365],
]);

// Manila calendar day, not UTC: 2026-09-30 16:30 UTC is already Oct 1 in Manila
assert.equal(manilaDateString(Date.UTC(2026, 8, 30, 16, 30)), '2026-10-01');
assert.equal(manilaDateString(Date.UTC(2026, 8, 30, 15, 59)), '2026-09-30');

// never logged → due today
let due = computeTaskDue(null, 7, NOW);
assert.deepEqual(due, { lastDone: null, nextDue: '2026-10-01', daysUntil: 0, status: 'today' });
assert.equal(dueLabel(due), 'Not yet logged');

// logged today → a full interval out
assert.deepEqual(computeTaskDue(iso(NOW), 7, NOW), {
  lastDone: '2026-10-01', nextDue: '2026-10-08', daysUntil: 7, status: 'soon',
});

// backdated log: done 2 days ago at 7 days → due in 5
const performedAt = performedAtFromDate('2026-09-29', NOW);
assert.equal(performedAt, '2026-09-29T04:00:00.000Z'); // noon PHT
due = computeTaskDue(performedAt, 7, NOW);
assert.deepEqual(due, { lastDone: '2026-09-29', nextDue: '2026-10-06', daysUntil: 5, status: 'soon' });
assert.equal(dueLabel(due), 'Due in 5d');

// overdue
due = computeTaskDue(iso(NOW - 10 * DAY), 7, NOW);
assert.equal(due.daysUntil, -3);
assert.equal(due.status, 'overdue');
assert.equal(dueLabel(due), 'Overdue 3d');

// due today, tomorrow, and good
assert.equal(computeTaskDue(iso(NOW - 7 * DAY), 7, NOW).status, 'today');
assert.equal(dueLabel(computeTaskDue(iso(NOW - 6 * DAY), 7, NOW)), 'Due tomorrow');
assert.equal(computeTaskDue(iso(NOW), 30, NOW).status, 'good');

// interval edited after a log moves the due date
const last = iso(NOW - 5 * DAY);
assert.equal(computeTaskDue(last, 7, NOW).daysUntil, 2);
due = computeTaskDue(last, 3, NOW);
assert.equal(due.daysUntil, -2);
assert.equal(due.status, 'overdue');

// unreadable timestamp is treated as never logged
assert.equal(computeTaskDue('not a date', 7, NOW).lastDone, null);

// latestBySchedule picks the newest log regardless of order
const map = latestBySchedule([
  { schedule_id: 'a', performed_at: '2026-09-01T00:00:00Z' },
  { schedule_id: 'a', performed_at: '2026-09-20T00:00:00Z' },
  { schedule_id: 'a', performed_at: '2026-09-10T00:00:00Z' },
  { schedule_id: null, performed_at: '2026-09-30T00:00:00Z' },
  { schedule_id: 'b', performed_at: '2026-08-01T00:00:00Z' },
]);
assert.equal(map.get('a'), '2026-09-20T00:00:00Z');
assert.equal(map.get('b'), '2026-08-01T00:00:00Z');
assert.equal(map.size, 2);

// performedAtFromDate: today → now; rejects future / malformed / impossible dates
assert.equal(performedAtFromDate('2026-10-01', NOW), iso(NOW));
assert.equal(performedAtFromDate('2026-10-02', NOW), null);
assert.equal(performedAtFromDate('2026-02-31', NOW), null);
assert.equal(performedAtFromDate('10/01/2026', NOW), null);
assert.equal(performedAtFromDate('', NOW), null);

// parseIntervalDays: whole days in 1..3650 only
assert.equal(parseIntervalDays('7'), 7);
assert.equal(parseIntervalDays(' 3650 '), 3650);
assert.equal(parseIntervalDays('0'), null);
assert.equal(parseIntervalDays('3651'), null);
assert.equal(parseIntervalDays('7.5'), null);
assert.equal(parseIntervalDays('-3'), null);
assert.equal(parseIntervalDays('abc'), null);

console.log('maintenance.test.mjs: all assertions passed');
