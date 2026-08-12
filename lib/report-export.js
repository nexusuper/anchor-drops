// CSV/print-HTML builders for pages/admin/ops/reports.js. Pure port of
// anchor-drops-system/src/lib/reportExport.ts — same output, same RFC 4180 +
// formula-injection escaping (matches pages/api/customers/export.js's approach:
// a leading =/+/-/@ gets a leading single quote so Excel/Sheets can't execute
// it as a formula).

export function toCsv(headers, rows) {
  const escape = (v) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

export function toHtmlTable(title, headers, rows) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: -apple-system, Roboto, sans-serif;">
    <h2>${esc(title)}</h2>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; font-size: 12px; width: 100%;">
      <thead>
        <tr>${headers.map((h) => `<th style="text-align:left; background:#f1f1f1;">${esc(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('\n        ')}
      </tbody>
    </table>
  </body>
</html>`;
}
