import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const MAX_VDF_BYTES = 256 * 1024;
const MANIFEST_NAME = 'appmanifest_730.acf';
const CFG_RELATIVE = ['steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg'];

function readSmall(path, max = MAX_VDF_BYTES) {
  try {
    if (lstatSync(path).size > max) return null;
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

function decodeVdfString(value) {
  return value.replace(/\\(["\\])/g, '$1');
}

/**
 * Extract only paths from the text KeyValues libraryfolders file.
 * This deliberately is not a generic VDF parser. Unexpected or damaged files
 * are ignored and the manual file picker remains available.
 */
export function steamLibraryPaths(vdf) {
  if (typeof vdf !== 'string' || vdf.length > MAX_VDF_BYTES) return [];
  const found = [];
  const regex = /"path"\s*"((?:\\.|[^"\\])*)"/gi;
  for (const match of vdf.matchAll(regex)) {
    const path = decodeVdfString(match[1]);
    if (path && !path.includes('\0')) found.push(path);
    if (found.length >= 32) break;
  }
  return [...new Set(found)];
}

function verifiedCfgDirectory(steamLibrary) {
  try {
    const root = resolve(steamLibrary);
    const manifest = join(root, 'steamapps', MANIFEST_NAME);
    const raw = readSmall(manifest, 128 * 1024);
    if (!raw || !/"appid"\s*"730"/i.test(raw)) return null;
    const cfg = join(root, ...CFG_RELATIVE);
    if (!lstatSync(cfg).isDirectory()) return null;
    // Reject symlinked final targets and symlinked game directory ancestors.
    const real = realpathSync(cfg);
    if (real !== resolve(cfg)) return null;
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Search explicit Steam roots and their registered library folders.
 * No process execution, registry changes, writes or filesystem-wide scans.
 */
export function discoverCs2ConfigDirectories({
  env = process.env,
  additionalSteamRoots = [],
} = {}) {
  const roots = [
    env.SteamPath,
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Steam'),
    env.ProgramFiles && join(env.ProgramFiles, 'Steam'),
    ...additionalSteamRoots,
  ].filter(path => typeof path === 'string' && path.trim());
  const libraries = new Set();
  for (const root of roots.slice(0, 16)) {
    libraries.add(resolve(root));
    const libraryFile = join(root, 'steamapps', 'libraryfolders.vdf');
    const vdf = readSmall(libraryFile);
    for (const path of steamLibraryPaths(vdf)) libraries.add(resolve(path));
    // Steam itself also stores this file under config in some versions.
    const fallback = readSmall(join(root, 'config', 'libraryfolders.vdf'));
    for (const path of steamLibraryPaths(fallback)) libraries.add(resolve(path));
  }
  const paths = new Set();
  for (const library of [...libraries].slice(0, 64)) {
    const cfg = verifiedCfgDirectory(library);
    if (cfg) paths.add(cfg);
  }
  return [...paths].sort();
}

export function isSafeCs2ConfigDirectory(path) {
  if (typeof path !== 'string' || !path) return false;
  // Confirm against the Steam library path implied by a game install;
  // mere existence of a random cfg directory is not sufficient.
  const libraryRoot = dirname(dirname(dirname(dirname(dirname(dirname(path))))));
  return verifiedCfgDirectory(libraryRoot) === resolve(path);
}
