// Does this string look like a customer-facing order number rather than a UUID?
// /api/orders/[id] accepts either and picks its lookup column with this.
//
// ADW = current prefix, CFW = pre-rename Clear Flow orders. Both still resolve;
// historic order numbers were left in place on the rebrand.
//
// The random segment is 1-4 characters, not 4. next_order_number() indexed its
// 32-character alphabet with ceil(random() * 33); index 33 is past the end and
// substr returns '', independently per character, so ~11.7% of order numbers
// were minted short (mostly 3 chars, ~0.5% of all orders at 2). Under a {4}
// pattern those orders resolved as a UUID lookup, found nothing, and could
// neither be tracked nor cancelled — by the customer holding the exact number
// printed on their own confirmation page.
//
// Migration 0030 in anchor-drops-system fixes the generator. The pattern stays
// widened rather than backfilling: the short number is what the affected
// customers wrote down and what their Messenger receipt says, so rewriting it
// would invalidate the only copy they hold. Widening is safe here because this
// pattern only chooses a lookup column — neither handle is returned without a
// matching phone, and self-cancel still requires the phone.
export const ORDER_NUMBER_RE = /^(ADW|CFW)-[A-Z]+-\d{6}-[A-Z0-9]{1,4}-\d+$/i;
