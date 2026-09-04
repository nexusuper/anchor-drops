// Isomorphic barangay validation for Cagayan de Oro. The order form's barangay
// field is free text, so anything typed became a real order — "hahaha" included.
// Matching against the city's actual barangay list is the cheapest filter that
// kills junk without a paid lookup service, and it also catches honest orders
// from outside the service city before a rider is dispatched.
//
// ponytail: a flat list + normalizer, not a geocoding API. The list changes
// roughly never, and a wrong-city order is a phone call, not a data problem.

// The 40 numbered poblacion barangays are generated; the rest are named.
const NAMED_BARANGAYS = [
  'Agusan', 'Balubal', 'Balulang', 'Baikingon', 'Bayabas', 'Bayanga', 'Besigan',
  'Bonbon', 'Bugo', 'Bulua', 'Camaman-an', 'Canito-an', 'Carmen', 'Consolacion',
  'Cugman', 'Dansolihon', 'F.S. Catanico', 'Gusa', 'Indahag', 'Iponan',
  'Kauswagan', 'Lapasan', 'Lumbia', 'Macabalan', 'Macasandig', 'Mambuaya',
  'Nazareth', 'Pagalungan', 'Pagatpat', 'Patag', 'Pigsag-an', 'Puerto',
  'Puntod', 'San Simon', 'Tablon', 'Taglimao', 'Tagpangi', 'Tignapoloan',
  'Tuburan', 'Tumpagon',
];

export const CDO_BARANGAYS = [
  ...NAMED_BARANGAYS,
  ...Array.from({ length: 40 }, (_, i) => `Barangay ${i + 1}`),
];

// Strips the honorifics people prefix ("Brgy. San Jose", "Bgy Carmen"), accents,
// and punctuation, so "Camaman-an", "camaman an" and "CAMAMAN–AN" all collapse
// to one key. Numbered barangays collapse to the bare number.
export function normalizeBarangay(value) {
  const base = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*(brgy|bgy|brgys|barangay|bar)\b\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return /^\d+$/.test(base) ? String(Number(base)) : base;
}

const BY_KEY = new Map(CDO_BARANGAYS.map((b) => [normalizeBarangay(b), b]));

// Returns the canonical barangay name, or null when the input is not a real CDO
// barangay. Callers store the canonical spelling so the admin's barangay
// grouping and delivery route stop fragmenting over spelling variants.
export function matchBarangay(value) {
  return BY_KEY.get(normalizeBarangay(value)) ?? null;
}
