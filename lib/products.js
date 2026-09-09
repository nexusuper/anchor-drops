export const BUSINESS_PHONE_DISPLAY = '0975-855-5055';
export const BUSINESS_PHONE_TEL = '+639758555055';
export const BUSINESS_EMAIL = 'anchordropscdo@gmail.com';
export const STORE_ADDRESS_DISPLAY = 'Phase 2B Block 1 Lot 49, Villa Trinitas, Bugo, Cagayan de Oro';

// GCash payment number — distinct from BUSINESS_PHONE_DISPLAY (the business's
// general contact number shown in the footer, track page, etc). Bank transfer
// pays via the same GCash QR (InstaPay/QR Ph), so there's no separate account.
export const GCASH_NUMBER_DISPLAY = '0927-222-5745';

// Store origin (exact GPS pin) for the admin "Open route in Google Maps" button.
// Google Maps dir/ accepts "lat,lng" as the origin segment.
export const STORE_MAP_ORIGIN = '8.511758,124.774072';

// Exact store pin — also LocationPicker's map center.
export const STORE_LAT = 8.511758;
export const STORE_LNG = 124.774072;

// Prices mirror the `products` table (sku, refill_price, container_price,
// is_active) in Supabase — that table is authoritative for what a customer is
// actually charged (see create_order RPC); this array is the display/estimate
// copy and must be kept in sync by hand when prices change there.
// Container+refill combo is a flat ₱160 on both active products: container_price
// is deliberately set to (combo - refill) rather than a standalone container
// cost, which is why the two active SKUs list different container prices for the
// same physical container. Verified against the live products table 2026-09-09;
// the retired slim5 still carries the old ₱180 combo.
// `fulfillment` is what the price actually buys, and the order form branches on
// it: 'pickup' = customer collects at the store (no address, no delivery run),
// 'delivery' = we deliver. The ₱25 store-pickup price used to be orderable with
// a delivery address attached, which sold a delivery run at the walk-in price.
export const PRODUCTS = [
  { id: 'round5_pickup', name: '5-Gallon Round (Store Pickup)', description: 'Round-type 5-gallon container refill. Order online, pick it up at the store.', refill: 25, container: 135, size: '5-Gal', tag: 'Store Pickup', fulfillment: 'pickup' },
  { id: 'round5', name: '5-Gallon Round (Delivery)', description: 'Round-type 5-gallon container refill, delivered to your door.', refill: 30, container: 130, size: '5-Gal', tag: 'Most Popular', fulfillment: 'delivery' },
  // Retired for launch — flip products.is_active for 'slim5' in the admin Settings
  // page's Products section to bring it back on the site.
  { id: 'slim5', name: '5-Gallon Slim', description: 'Slim-type 5-gallon container refill. Fits most standard dispensers.', refill: 30, container: 150, size: '5-Gal', tag: 'Standard', fulfillment: 'delivery' },
];

export const PRODUCTS_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

// Store-pickup orders carry no customer address, but `orders.address`/`barangay`
// are NOT NULL and every admin view reads them — so the server stamps the store's
// own location instead. The prefix keeps a pickup obvious in the orders list and
// the barangay-grouped delivery route.
export const STORE_PICKUP_ADDRESS = `Store pickup — ${STORE_ADDRESS_DISPLAY}`;
export const STORE_PICKUP_BARANGAY = 'Bugo';

export function isStorePickup(productId) {
  return PRODUCTS_BY_ID[productId]?.fulfillment === 'pickup';
}
