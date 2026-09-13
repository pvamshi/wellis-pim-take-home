import { p01 } from './catalogue/p01';
import { p02 } from './catalogue/p02';
import { p03 } from './catalogue/p03';
import { p04 } from './catalogue/p04';
import { p05 } from './catalogue/p05';
import { p06 } from './catalogue/p06';
import { p07 } from './catalogue/p07';
import { p08 } from './catalogue/p08';
import { p09 } from './catalogue/p09';
import { p10 } from './catalogue/p10';
import { p11 } from './catalogue/p11';
import { p12 } from './catalogue/p12';
import { p13 } from './catalogue/p13';
import { p14 } from './catalogue/p14';
import { p15 } from './catalogue/p15';
import { p16 } from './catalogue/p16';
import { p17 } from './catalogue/p17';
import { p18 } from './catalogue/p18';
import { p19 } from './catalogue/p19';
import { p20 } from './catalogue/p20';
import { p21 } from './catalogue/p21';
import { p22 } from './catalogue/p22';
import { p23 } from './catalogue/p23';
import { p24 } from './catalogue/p24';
import { p25 } from './catalogue/p25';
import type { CatalogueRule } from './rule-contract';

/**
 * Every `(ruleId, version)` the codebase has code for.
 *
 * An explicit list, not a directory scan and not decorators. Old versions stay
 * registered forever (1.1.1, 1.1.8) because the rule rows already written — and
 * the modification log that reads them (1.3) — point at them by version; a
 * convention that scans the filesystem loses a version the moment someone
 * tidies a file away, and loses it silently. An entry here means deleting code
 * is a visible diff.
 *
 * Entries are appended, never removed and never renumbered. A new version of a
 * rule is a new entry alongside the old one, not an edit to it.
 *
 * Entries carry the `rule` row's fields alongside the code, so `just rules-sync`
 * can make the database match this file without a second source of truth.
 */
export const ruleCatalogue: readonly CatalogueRule[] = [
  p01,
  p02,
  p03,
  p04,
  p05,
  p06,
  p07,
  p08,
  p09,
  p10,
  p11,
  p12,
  p13,
  p14,
  p15,
  p16,
  p17,
  p18,
  p19,
  p20,
  p21,
  p22,
  p23,
  p24,
  p25,
];
