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
// Container+refill combo is a flat ₱180 for every product: container_price is
// deliberately set to (180 - refill) rather than a standalone container cost.
export const PRODUCTS = [
  { id: 'round5_pickup', name: '5-Gallon Round (Pickup)', description: 'Round-type 5-gallon container refill. Order online, pick up at the store.', refill: 25, container: 155, size: '5-Gal', tag: 'Walk-In' },
  { id: 'round5', name: '5-Gallon Round (Delivery)', description: 'Round-type 5-gallon container refill, delivered to your door.', refill: 30, container: 150, size: '5-Gal', tag: 'Most Popular' },
  // Retired for launch — flip products.is_active for 'slim5' in the admin Settings
  // page's Products section to bring it back on the site.
  { id: 'slim5', name: '5-Gallon Slim', description: 'Slim-type 5-gallon container refill. Fits most standard dispensers.', refill: 30, container: 150, size: '5-Gal', tag: 'Standard' },
];

export const PRODUCTS_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
