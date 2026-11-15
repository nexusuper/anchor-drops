import assert from 'node:assert/strict';
import {
  classifyPickupTime, addDays, computeAutomaticDelivery, computeAllowedDeliveryWindow,
  validateSchedule, manilaNowTime, STORE_TIME_SLOTS, timeSlots,
} from '../lib/scheduling.js';

assert.equal(manilaNowTime(new Date('2026-07-03T06:30:00Z')), '14:30');
assert.equal(manilaNowTime(new Date('2026-07-03T16:05:00Z')), '00:05');
assert.equal(STORE_TIME_SLOTS[0], '08:00');
assert.equal(STORE_TIME_SLOTS.at(-1), '17:00');
assert.ok(!STORE_TIME_SLOTS.includes('12:00'));
assert.ok(!STORE_TIME_SLOTS.includes('12:30'));
assert.ok(STORE_TIME_SLOTS.every((t) => classifyPickupTime(t)));
assert.deepEqual(timeSlots({ minTime: '11:30', maxTime: '13:30' }), ['11:30', '13:00', '13:30']);
assert.equal(timeSlots({ date: '2026-07-03', today: '2026-07-03', nowTime: '14:10' })[0], '14:30');
assert.equal(timeSlots({ date: '2026-07-04', today: '2026-07-03', nowTime: '14:10' })[0], '08:00');
assert.deepEqual(timeSlots({ date: '2026-07-03', today: '2026-07-03', nowTime: '17:00' }), []);
for (const time of ['07:59', '12:00', '12:01', '12:30', '12:59', '17:01', 'bad']) {
  assert.equal(classifyPickupTime(time), null);
}
assert.equal(classifyPickupTime('08:00'), 'morning');
assert.equal(classifyPickupTime('11:59'), 'morning');
assert.equal(classifyPickupTime('13:00'), 'afternoon');
assert.equal(classifyPickupTime('17:00'), 'afternoon');
assert.equal(addDays('2026-07-31', 1), '2026-08-01');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');

for (const [pickupTime, deliveryTime, isNextDay] of [
  ['08:00', '09:00', false], ['09:00', '10:00', false],
  ['10:30', '11:30', false], ['11:00', '13:00', false],
  ['11:30', '13:00', false], ['13:00', '14:00', false],
  ['14:30', '15:30', false], ['16:00', '17:00', false],
  ['16:01', '08:00', true], ['16:30', '08:00', true], ['17:00', '08:00', true],
]) {
  const pickupDate = '2026-12-31';
  const deliveryDate = isNextDay ? '2027-01-01' : pickupDate;
  assert.deepEqual(computeAutomaticDelivery({ pickupDate, pickupTime }), { deliveryDate, deliveryTime, isNextDay });
  assert.deepEqual(validateSchedule({ hasEmptyContainers: true, pickupDate, pickupTime,
    deliveryDate, deliveryTime, today: pickupDate }), { ok: true });
}
assert.equal(computeAutomaticDelivery({ pickupDate: 'bad', pickupTime: '08:00' }), null);
assert.equal(computeAutomaticDelivery({ pickupDate: '2026-11-31', pickupTime: '08:00' }), null);
assert.equal(validateSchedule({ hasEmptyContainers: false, deliveryDate: '2026-02-30', deliveryTime: '08:00', today: '2026-02-01' }).ok, false);
assert.equal(computeAutomaticDelivery({ pickupDate: '2026-07-03', pickupTime: '12:00' }), null);
assert.deepEqual(computeAllowedDeliveryWindow({ pickupDate: '2026-07-03', pickupTime: '09:00' }), {
  minDate: '2026-07-03', maxDate: '2026-07-03', minTime: '10:00', maxTime: '10:00',
});
// Sunday remains open; scheduling does not depend on the current booking time.
assert.deepEqual(computeAutomaticDelivery({ pickupDate: '2026-07-05', pickupTime: '14:00' }), {
  deliveryDate: '2026-07-05', deliveryTime: '15:00', isNextDay: false,
});
const refill = { hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '09:00',
  deliveryDate: '2026-07-03', deliveryTime: '10:00', today: '2026-07-03' };
for (const changes of [
  { deliveryTime: '11:00' }, { deliveryTime: '14:00' }, { deliveryTime: '08:00' },
  { deliveryDate: '2026-07-04' }, { pickupTime: '12:30' }, { pickupDate: '2026-07-02' },
  { pickupDate: null }, { deliveryTime: null }, { nowTime: '09:00' }, { today: 'bad' },
]) assert.equal(validateSchedule({ ...refill, ...changes }).ok, false);
assert.deepEqual(validateSchedule({ ...refill, nowTime: '08:59' }), { ok: true });

// Delivery-only and store pickup retain manually selected open-hour schedules.
const direct = { hasEmptyContainers: false, deliveryDate: '2026-07-05', deliveryTime: '10:00', today: '2026-07-03' };
for (const deliveryTime of ['08:00', '10:00', '13:00', '14:00', '17:00']) {
  assert.deepEqual(validateSchedule({ ...direct, deliveryTime }), { ok: true });
}
for (const changes of [
  { deliveryTime: '12:00' }, { deliveryTime: '12:30' }, { deliveryTime: '19:00' },
  { deliveryDate: '2026-07-02' }, { deliveryDate: '2026-07-03', nowTime: '10:00' },
]) assert.equal(validateSchedule({ ...direct, ...changes }).ok, false);
console.log('scheduling.test.mjs: all assertions passed');
