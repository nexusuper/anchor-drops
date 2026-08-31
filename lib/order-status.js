export const ORDER_STATUS = {
  pending: { label: 'Pending', badge: 'bg-clay-warning-bg text-clay-warning border border-clay-warning/20' },
  confirmed: { label: 'Confirmed', badge: 'bg-sky-100 text-sky-700 border border-sky-200' },
  out_for_delivery: { label: 'Out for Delivery', badge: 'bg-orange-100 text-orange-700 border border-orange-200' },
  delivered: { label: 'Delivered', badge: 'bg-clay-success-bg text-clay-success border border-clay-success/20' },
  cancelled: { label: 'Cancelled', badge: 'bg-clay-danger-bg text-clay-danger border border-clay-danger/20' },
};

export const ORDER_STATUS_LABELS = Object.fromEntries(
  Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label])
);

export const ORDER_STATUS_BADGE = Object.fromEntries(
  Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.badge])
);
