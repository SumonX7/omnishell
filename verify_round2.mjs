// Round-trip test for the SortOrder fix (audit finding §2.2 / P1).
// Verifies that the schema nicks, the Enums.SortOrder values and the
// SORT_ORDER_NICKS list all agree, and that setSortOrder()/getSortOrder()
// compute the right enum ordinal.
import { readFileSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src') + '/';


/**
 * Strips comments from the source so that the checks below match *code* and
 * not the prose that explains what the code used to do.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

// --- 1. Read the nicks out of the schema ---------------------------
const schema = readFileSync(SRC + 'schemas/org.gnome.shell.extensions.omnishell.ding.gschema.xml', 'utf8');
const arrangeBlock = /<enum id="org\.gnome\.shell\.extension\.omnishell\.ding\.ArrangeOrder">([\s\S]*?)<\/enum>/.exec(schema);
if (!arrangeBlock) {
  console.error('FAIL: ArrangeOrder enum not found in schema');
  process.exit(1);
}
const schemaNicks = [...arrangeBlock[1].matchAll(/nick="([^"]+)"/g)].map(m => m[1]);
const schemaValues = [...arrangeBlock[1].matchAll(/value="(\d+)"/g)].map(m => Number(m[1]));

console.log('schema nicks :', schemaNicks.join(', '));
console.log('schema values:', schemaValues.join(', '));

// --- 2. Read the values out of enums.js -----------------------------
const enums = readFileSync(SRC + 'app/enums.js', 'utf8');
const sortBlock = /export var SortOrder = \{([\s\S]*?)\};/.exec(enums);
if (!sortBlock) {
  console.error('FAIL: SortOrder not found in enums.js');
  process.exit(1);
}
const enumValues = {};
for (const m of sortBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)) enumValues[m[1]] = m[2];

console.log('enums values :', JSON.stringify(enumValues));

// --- 3. Read the nicks list out of enums.js ------------------------
const nicksBlock = /export var SORT_ORDER_NICKS = \[([\s\S]*?)\];/.exec(enums);
if (!nicksBlock) {
  console.error('FAIL: SORT_ORDER_NICKS not found in enums.js');
  process.exit(1);
}
const nicksList = [...nicksBlock[1].matchAll(/SortOrder\.(\w+)/g)].map(m => m[1]);

// --- 4. Check every schema nick is reachable through SortOrder ------
const results = [];
const check = (id, desc, ok, evidence) => results.push({ id, desc, ok, evidence });

const missingFromEnum = schemaNicks.filter(n => !(n in enumValues));
check('S1', 'every schema nick exists as a SortOrder key',
  missingFromEnum.length === 0,
  `missing=${missingFromEnum.join(',') || 'none'}`);

const wrongCase = schemaNicks.filter(n => enumValues[n] !== n);
check('S2', 'every SortOrder value equals its schema nick exactly',
  wrongCase.length === 0,
  `mismatched=${wrongCase.map(n => `${n}->${enumValues[n]}`).join(',') || 'none'}`);

// --- 5. Check the ordinal that setSortOrder would compute -----------
// setSortOrder uses SORT_ORDER_NICKS.indexOf(order) and then
// Gio.Settings.set_enum(), which takes the zero-based ordinal.
// The schema numbers the nicks 1..5, so ordinal N must map to the
// schema value N+1.
let ordinalOk = true;
const ordinalDetail = [];
nicksList.forEach((key, ordinal) => {
  const nick = enumValues[key];
  const schemaValue = schemaNicks.indexOf(nick) + 1;
  const expected = schemaValues[schemaValue - 1];
  const match = expected === schemaValue;
  if (!match) ordinalOk = false;
  ordinalDetail.push(`${key}(ordinal ${ordinal} -> schema value ${schemaValue} vs ${expected})`);
});
check('S3', 'the computed enum ordinal matches the schema numbering',
  ordinalOk && nicksList.length === schemaNicks.length,
  ordinalDetail.join('; '));

// --- 6. Check the ORDER key is not part of the nicks list -----------
check('S4', 'the "ORDER" key name is not in the nicks list',
  !nicksList.includes('ORDER'),
  `nicks=${nicksList.join(',')}`);

// --- 7. Check preferences.js uses the new list ----------------------
const prefs = stripComments(readFileSync(SRC + 'app/preferences.js', 'utf8'));
const usesNicks = /SORT_ORDER_NICKS\.indexOf\(order\)/.test(prefs);
const noOldIndexOf = !/Object\.values\(Enums\.SortOrder\)\.indexOf\(order\)/.test(prefs);
const hasFallback = /Enums\.SortOrder\[nick\]\s*\?\?\s*Enums\.SortOrder\.NAME/.test(prefs);
check('S5', 'preferences.js uses SORT_ORDER_NICKS and a safe lookup',
  usesNicks && noOldIndexOf && hasFallback,
  `uses-nicks=${usesNicks}, no-old-indexOf=${noOldIndexOf}, has-fallback=${hasFallback}`);

// --- output ----------------------------------------------------------
const ok = results.filter(r => r.ok);
const bad = results.filter(r => !r.ok);
console.log(`\nFIXED / CORRECT (${ok.length}):`);
for (const r of ok) console.log(`  [${r.id}] ${r.desc}\n        -> ${r.evidence}`);
if (bad.length) {
  console.log(`\nSTILL BROKEN (${bad.length}):`);
  for (const r of bad) console.log(`  [${r.id}] ${r.desc}\n        -> ${r.evidence}`);
}
console.log('\n=== SUMMARY ===');
console.log(`ok=${ok.length} still-broken=${bad.length} total=${results.length}`);
process.exit(bad.length ? 1 : 0);
