import assert from 'node:assert/strict';
import { toCsv, toHtmlTable } from '../lib/report-export.js';

// toCsv: basic
assert.equal(toCsv(['A', 'B'], [[1, 2], ['x', 'y']]), 'A,B\n1,2\nx,y');

// toCsv: quoting for comma/quote/newline
assert.equal(toCsv(['H'], [['a,b']]), 'H\n"a,b"');
assert.equal(toCsv(['H'], [['a"b']]), 'H\n"a""b"');
assert.equal(toCsv(['H'], [['a\nb']]), 'H\n"a\nb"');

// toCsv: formula-injection guard
assert.equal(toCsv(['H'], [['=SUM(A1)']]), "H\n'=SUM(A1)");
assert.equal(toCsv(['H'], [['+1']]), "H\n'+1");
assert.equal(toCsv(['H'], [['-1']]), "H\n'-1");
assert.equal(toCsv(['H'], [['@cmd']]), "H\n'@cmd");
assert.equal(toCsv(['H'], [['normal']]), 'H\nnormal');

// toHtmlTable: escapes and structure
const html = toHtmlTable('My <Title> & Co', ['H1'], [['<b>x</b>']]);
assert.match(html, /My &lt;Title&gt; &amp; Co/);
assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
assert.match(html, /<table/);

console.log('report-export.test.mjs: all assertions passed');
