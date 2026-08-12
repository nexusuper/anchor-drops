// Fixed expense categories. Isomorphic — the API validates against this list
// and the admin form renders it. `category` is a free-text column in the DB;
// keeping the vocabulary here is what makes the totals add up.
export const EXPENSE_CATEGORIES = [
  'fuel',
  'supplies',
  'utilities',
  'salaries',
  'maintenance',
  'rent',
  'transport',
  'other',
];
