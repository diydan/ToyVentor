#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Keep the public copies of the Describe & build files byte-identical to the sources in parts/kip/viewer.
//
// The page is served from public/kip/, the sources live in parts/kip/viewer/, and the two must never drift (the Truck-Mockup pattern). Once scripts/build-kip.ts
// lists these files, `npm run build:kip` does the same copy and this tool becomes a double check; until then it is the mirror.
//
//   node parts/kip/viewer/tools/sync_public.mjs           copy any file that differs
//   node parts/kip/viewer/tools/sync_public.mjs --check   exit 1 if any public copy is missing or differs (writes nothing)
//
// The 30 STLs are not copied: tools/export_describe_stls.py writes them straight into public/kip/partspec/describe/ (and has its own --check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..');
const PUBLIC = path.join(VIEWER, '..', '..', '..', 'public', 'kip');
export const FILES = [
  'kip-describe.js', 'kip-describe-validate.js', 'kip-describe-view.js', 'kip-describe-tab.js',
  'kip-describe-recipes.json', 'kip-describe-parts.json',
];

/** { file, state } per file: 'same', 'differs' or 'missing' (public copy against its source). */
export function compare() {
  return FILES.map((file) => {
    const dst = path.join(PUBLIC, file);
    if (!fs.existsSync(dst)) return { file, state: 'missing' };
    return { file, state: fs.readFileSync(path.join(VIEWER, file)).equals(fs.readFileSync(dst)) ? 'same' : 'differs' };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const { file, state } of compare()) {
    if (state === 'same') continue;
    if (check) { console.log(`${state.toUpperCase()}: public/kip/${file}`); bad++; continue; }
    fs.mkdirSync(PUBLIC, { recursive: true });
    fs.copyFileSync(path.join(VIEWER, file), path.join(PUBLIC, file));
    console.log(`copied ${file} (${state})`);
  }
  if (check) console.log(bad ? `${bad} of ${FILES.length} public copies stale` : `all ${FILES.length} public copies are byte-identical to their sources`);
  else console.log(`synced: ${FILES.length - bad} files checked`);
  process.exit(check && bad ? 1 : 0);
}
