// Pure, isomorphic pickup/delivery scheduling rules — shared by the order
// form (client) and the orders API (server, source of truth).
//
// Store hours: every day, 08:00-12:00 and 13:00-17:00.

export const PICKUP_MORNING_START = '08:00';
export const PICKUP_MORNING_END = '12:00';
export const PICKUP_AFTERNOON_START = '13:00';
export const PICKUP_AFTERNOON_END = '17:00';

export const DELIVERY_SAME_DAY_START = '13:00';
export const DELIVERY_SAME_DAY_END = '17:00';
export const DELIVERY_NEXT_DAY_START = '08:00';
export const DELIVERY_NEXT_DAY_END = '17:00';

export const DELIVERY_ONLY_START = '08:00';
export const DELIVERY_ONLY_END = '17:00';

// Human-readable label for the store-hours windows, for UI hint text.
export const STORE_HOURS_LABEL = '8:00 AM–12:00 PM or 1:00–5:00 PM, Mon–Sun';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTime(t) {
  return typeof t === 'string' && TIME_RE.test(t);
}

function isValidDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const date = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
}

// String comparison is safe for 'HH:MM' (zero-padded, fixed width) and
// 'YYYY-MM-DD' (zero-padded, fixed width) — no need to parse into Date objects.
function timeInRange(t, start, end) {
  return t >= start && t <= end;
}

// The business runs on Manila time (UTC+8). Deriving "today" from UTC means
// that between midnight and 08:00 PH the UTC date is still yesterday, so the
// date picker offers — and the server accepts — a delivery in the past.
export function manilaToday(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

// Current Manila wall-clock time as 'HH:MM', for rejecting slots already passed today.
export function manilaNowTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

// Every bookable time, 30 minutes apart, inside store hours (lunch gap excluded).
// The form offers only these, because native time pickers on mobile ignore min/max.
export const STORE_TIME_SLOTS = [];
for (let m = 8 * 60; m <= 17 * 60; m += 30) {
  if (m >= 12 * 60 && m < 13 * 60) continue;
  STORE_TIME_SLOTS.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

// Slots within [minTime, maxTime], minus any already passed when date is today.
export function timeSlots({ minTime = '08:00', maxTime = '17:00', date, today, nowTime } = {}) {
  return STORE_TIME_SLOTS.filter((t) => t >= minTime && t <= maxTime && !(date && date === today && nowTime && t <= nowTime));
}

// True for a time inside either store-hours window (08:00-12:00 or 13:00-17:00).
export function classifyPickupTime(time) {
  if (!isValidTime(time)) return null;
  if (time >= PICKUP_MORNING_START && time < PICKUP_MORNING_END) return 'morning';
  if (timeInRange(time, PICKUP_AFTERNOON_START, PICKUP_AFTERNOON_END)) return 'afternoon';
  return null;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Choose the first bookable slot one to two hours after the scheduled pickup.
export function computeAutomaticDelivery({ pickupDate, pickupTime }) {
  if (!isValidDate(pickupDate) || !classifyPickupTime(pickupTime)) return null;
  const [hours, minutes] = pickupTime.split(':').map(Number);
  const pickupMinutes = hours * 60 + minutes;
  const deliveryTime = STORE_TIME_SLOTS.find((time) => {
    const [h, m] = time.split(':').map(Number);
    const delay = h * 60 + m - pickupMinutes;
    return delay >= 60 && delay <= 120;
  });
  return {
    deliveryDate: deliveryTime ? pickupDate : addDays(pickupDate, 1),
    deliveryTime: deliveryTime || DELIVERY_NEXT_DAY_START,
    isNextDay: !deliveryTime,
  };
}

export function computeAllowedDeliveryWindow(pickup) {
  const delivery = computeAutomaticDelivery(pickup);
  if (!delivery) return null;
  return {
    minDate: delivery.deliveryDate, maxDate: delivery.deliveryDate,
    minTime: delivery.deliveryTime, maxTime: delivery.deliveryTime,
  };
}

// today: 'YYYY-MM-DD' string, injected by the caller (never computed internally)
// so this function stays pure and testable without mocking the clock.
// nowTime: optional Manila 'HH:MM'; when given, a time earlier today is rejected.
export function validateSchedule({ hasEmptyContainers, pickupDate, pickupTime, deliveryDate, deliveryTime, today, nowTime }) {
  if (!isValidDate(today)) return { ok: false, error: 'Invalid reference date' };
  const passed = (date, time) => isValidTime(nowTime) && date === today && time <= nowTime;
  if (!isValidDate(deliveryDate) || !isValidTime(deliveryTime)) {
    return { ok: false, error: 'Delivery date/time required' };
  }

  if (!hasEmptyContainers) {
    if (deliveryDate < today) return { ok: false, error: 'Delivery date cannot be in the past' };
    if (!classifyPickupTime(deliveryTime)) {
      return { ok: false, error: 'Delivery time must be 8:00 AM-12:00 PM or 1:00-5:00 PM' };
    }
    if (passed(deliveryDate, deliveryTime)) return { ok: false, error: 'That time has already passed today — choose a later time' };
    return { ok: true };
  }

  if (!isValidDate(pickupDate) || !isValidTime(pickupTime)) {
    return { ok: false, error: 'Pickup date/time required' };
  }
  if (pickupDate < today) return { ok: false, error: 'Pickup date cannot be in the past' };
  if (!classifyPickupTime(pickupTime)) {
    return { ok: false, error: 'Pickup time must be 8:00 AM-12:00 PM or 1:00-5:00 PM' };
  }
  if (passed(pickupDate, pickupTime)) return { ok: false, error: 'That pickup time has already passed today — choose a later time' };

  const delivery = computeAutomaticDelivery({ pickupDate, pickupTime });
  if (!delivery || deliveryDate !== delivery.deliveryDate || deliveryTime !== delivery.deliveryTime) {
    return { ok: false, error: 'Delivery must match the automatic schedule for this pickup time' };
  }

  return { ok: true };
}
