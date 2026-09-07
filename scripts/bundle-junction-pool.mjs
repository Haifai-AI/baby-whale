#!/usr/bin/env node
// Pool-based junction materialization for the Windows portable bundle.
//
// Why: the bundle must contain ZERO links (junctions/symlinks do not
// survive zip -> extract on user machines), but pnpm's hoisted layout
// links workspace packages through ~2.5k junction sites.
//
// Model — resolution-aware, not closure-aware. Node resolves bare
// specifiers by walking UP through ancestor node_modules dirs. So a
// site copy only needs its own REAL files (inner links skipped — a
// cycle has no finite closed expansion, learned the hard way via
// ENAMETOOLONG), provided EVERY package name is reachable up the
// ancestor chain. That guarantee comes from root canonicalization:
// every workspace package is additionally materialized once at
// node_modules/<name> in the stage. Then any skipped inner link
// resolves to the canonical copy, and shadowing semantics stay intact
// (real nested node_modules dirs inside packages are copied as-is).
//
// Node does this step because it resolves links natively; PowerShell's
// .Target reports mangled paths for pnpm junctions.
//
// Usage: BW_POOL_DIR=<scratch> node bundle-junction-pool.mjs <sourceRoot> <mapFile>
// Emits <mapFile>: { sites, roots, targets, fileSites }

import fs from 'node:fs';
import path from 'node:path';

const [srcRoot, mapFile] = process.argv.slice(2);
const poolDir = process.env.BW_POOL_DIR;
if (!srcRoot || !mapFile || !poolDir) {
  console.error('usage: BW_POOL_DIR=<scratch> node bundle-junction-pool.mjs <sourceRoot> <mapFile>');
  process.exit(2);
}

// Exact root-level exclusions — mirrors make-bundle.ps1's /XD list, plus
// node_modules/.pnpm (excluded from the stage copy, so sites under it are
// dead weight). robocopy /XD matches these as exact paths, not segments.
const ROOT_EXCLUDES = new Set([
  '.git', '.github', '.artifacts', '.dsh-build', 'coverage', 'tmp', 'dist', path.join('scripts', 'tmp'),
]);
const PNPM_SEG = path.join('node_modules', '.pnpm');

function excluded(relFromRoot) {
  if (ROOT_EXCLUDES.has(relFromRoot)) return true;
  return relFromRoot === PNPM_SEG || relFromRoot.startsWith(PNPM_SEG + path.sep);
}

// --- 1. enumerate physical link sites (never descend into them) ---
const sites = []; // { siteAbs, targetReal, isFile }
const walkStack = [srcRoot];
while (walkStack.length) {
  const dir = walkStack.pop();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      let targetReal = null;
      let isFile = false;
      try {
        targetReal = fs.realpathSync(full);
        isFile = fs.lstatSync(targetReal).isFile();
      } catch {
        continue; // broken link — nothing to materialize
      }
      sites.push({ siteAbs: full, targetReal, isFile });
      continue;
    }
    if (ent.isDirectory()) {
      const rel = path.relative(srcRoot, full);
      if (excluded(rel)) continue;
      walkStack.push(full);
    }
  }
}

// --- 2. group sites by unique target; build one-level pool entries ---
const targets = new Map(); // targetReal -> { idx, isFile }
for (const s of sites) {
  if (!targets.has(s.targetReal)) {
    targets.set(s.targetReal, { idx: targets.size, isFile: s.isFile });
  }
}
const poolPathOf = (e) => path.join(poolDir, String(e.idx));

// Copy a real directory tree. Link entries pointing at FILES are
// dereferenced inline (a file cannot participate in a cycle); link
// entries pointing at DIRS are skipped — root canonicalization makes
// their packages reachable by walk-up.
function copyRealDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isSymbolicLink()) {
      let t = null;
      try {
        t = fs.realpathSync(s);
      } catch {
        continue; // broken inner link — leave it out
      }
      let st = null;
      try {
        st = fs.lstatSync(t);
      } catch {
        continue;
      }
      if (st.isFile()) fs.copyFileSync(t, d);
      continue; // dir links: resolved by walk-up to the canonical copy
    }
    if (ent.isDirectory()) copyRealDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(poolDir, { recursive: true });
for (const [target, e] of targets) {
  if (e.isFile) fs.copyFileSync(target, poolPathOf(e));
  else copyRealDir(target, poolPathOf(e));
}

// --- 3. root canonicalization: every workspace package also at root ---
// A target is a workspace package if it has a package.json with a name.
// Emit node_modules/<name> population entries unless that name is
// already a real dir at the stage root (external deps are — hoisted
// put them there; workspace names are not).
const roots = [];
const seenNames = new Set();
for (const [target, e] of targets) {
  if (e.isFile) continue;
  let name = null;
  try {
    name = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name;
  } catch {
    continue; // not a package root — sites still get their one-level copy
  }
  if (!name || seenNames.has(name)) continue;
  seenNames.add(name);
  roots.push({ site: path.join('node_modules', name), pool: path.relative(poolDir, poolPathOf(e)) });
}

// --- 4. emit the site -> pool map for PowerShell's parallel copies ---
const map = {
  targets: targets.size,
  fileSites: sites.filter((s) => s.isFile).length,
  roots: roots.length,
  sites: sites.map((s) => ({
    site: path.relative(srcRoot, s.siteAbs),
    pool: path.relative(poolDir, poolPathOf(targets.get(s.targetReal))),
    isFile: s.isFile,
  })),
  roots,
};
fs.writeFileSync(mapFile, JSON.stringify(map));
console.log(`    junction pool: ${sites.length} sites (${map.fileSites} file) -> ${targets.size} unique targets; ${roots.length} root canonical copies`);
