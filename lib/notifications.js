// Per-status notification message templates, shared by manual and auto notify.
export const NOTIFIABLE_STATUSES = ['confirmed', 'out_for_delivery', 'delivered', 'cancelled'];

const SMS_MESSAGES = {
  confirmed: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) has been confirmed and is being prepared. We'll be on our way soon! 💧`,
  out_for_delivery: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) is now OUT FOR DELIVERY! 🛵 Our rider is heading to you. Please be available to receive it. Thank you!`,
  delivered: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) has been delivered. 🎉 Thank you for choosing Anchor Drops! Order again anytime.`,
  cancelled: (name, id) =>
    `Hi ${name}, your Anchor Drops water order (ID: ${id}) has been cancelled. Please call us at 0912-345-6789 if you have questions.`,
};

const MESSENGER_MESSAGES = {
  confirmed: (name, id) =>
    `✅ Hi ${name}! Your Anchor Drops water order (#${id}) has been confirmed and is being prepared.\n\nWe'll notify you when it's on the way! 💧`,
  out_for_delivery: (name, id) =>
    `🛵 Hi ${name}! Your Anchor Drops water order (#${id}) is now OUT FOR DELIVERY!\n\nOur rider is heading to you. Please be available to receive it. Thank you! 💧`,
  delivered: (name, id) =>
    `🎉 Hi ${name}! Your Anchor Drops water order (#${id}) has been delivered!\n\nThank you for choosing Anchor Drops! Order again anytime at our website. 💧`,
  cancelled: (name, id) =>
    `❌ Hi ${name}, your Anchor Drops water order (#${id}) has been cancelled.\n\nIf you have questions, please reply to this message or call us at 0912-345-6789.`,
};

export function buildStatusMessage(order, status, channel) {
  const table = channel === 'messenger' ? MESSENGER_MESSAGES : SMS_MESSAGES;
  const fn = table[status];
  return fn ? fn(order.customer_name, order.id) : null;
}

export const PICKUP_NOTIFIABLE_STATUSES = ['scheduled', 'picked_up', 'delivered'];

const PICKUP_SMS_MESSAGES = {
  scheduled: (name, pickupDate, pickupTime, qty) =>
    `Hi ${name}! We've scheduled pickup of your ${qty} empty container(s) on ${pickupDate} at ${pickupTime}. Please have them ready outside. Thank you! 💧`,
  picked_up: (name, deliveryDate, deliveryTime) =>
    `Hi ${name}! We've picked up your empty containers. Your refilled water will be delivered on ${deliveryDate} at ${deliveryTime}. 🛵`,
  delivered: (name) =>
    `Hi ${name}! Your refilled water has been delivered. 🎉 Thank you for choosing Anchor Drops!`,
};

const PICKUP_MESSENGER_MESSAGES = {
  scheduled: (name, pickupDate, pickupTime, qty) =>
    `📦 Hi ${name}! We've scheduled pickup of your ${qty} empty container(s) on ${pickupDate} at ${pickupTime}.\n\nPlease have them ready outside. Thank you! 💧`,
  picked_up: (name, deliveryDate, deliveryTime) =>
    `🛵 Hi ${name}! We've picked up your empty containers.\n\nYour refilled water will be delivered on ${deliveryDate} at ${deliveryTime}. 💧`,
  delivered: (name) =>
    `🎉 Hi ${name}! Your refilled water has been delivered.\n\nThank you for choosing Anchor Drops! 💧`,
};

export function buildPickupStatusMessage(pickup, status, channel) {
  const table = channel === 'messenger' ? PICKUP_MESSENGER_MESSAGES : PICKUP_SMS_MESSAGES;
  const fn = table[status];
  if (!fn) return null;
  if (status === 'scheduled') {
    return fn(pickup.customer_name, pickup.pickup_date, pickup.pickup_time, pickup.container_qty);
  }
  if (status === 'picked_up') {
    return fn(pickup.customer_name, pickup.delivery_date, pickup.delivery_time, pickup.container_qty);
  }
  return fn(pickup.customer_name);
}
