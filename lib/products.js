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

export const PRODUCTS = [
  { id: 'slim5', name: '5-Gallon Slim', description: 'Slim-type 5-gallon container refill. Fits most standard dispensers.', refill: 30, container: 150, size: '5-Gal', tag: 'Standard' },
  { id: 'round5', name: '5-Gallon Round', description: 'Round-type 5-gallon container refill. Standard round bottom dispenser.', refill: 35, container: 170, size: '5-Gal', tag: 'Most Popular' },
];

export const PRODUCTS_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export const DELIVERY_RULES = [
  { min: 5, fee: 0, label: '5+ containers', feeLabel: 'FREE' },
  { min: 2, fee: 15, label: '2–4 containers', feeLabel: '₱15' },
  { min: 1, fee: 20, label: '1 container', feeLabel: '₱20' },
];

export function deliveryFee(qty) {
  if (qty >= 5) return 0;
  if (qty >= 2) return 15;
  return 20;
}
