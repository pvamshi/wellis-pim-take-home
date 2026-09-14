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
import { p26 } from './catalogue/p26';
import { p27 } from './catalogue/p27';
import { p28 } from './catalogue/p28';
import { p29 } from './catalogue/p29';
import { p30 } from './catalogue/p30';
import { p31 } from './catalogue/p31';
import { p32 } from './catalogue/p32';
import { p33 } from './catalogue/p33';
import { p34 } from './catalogue/p34';
import { p35 } from './catalogue/p35';
import { p36 } from './catalogue/p36';
import { p37 } from './catalogue/p37';
import { p38 } from './catalogue/p38';
import { p39 } from './catalogue/p39';
import { p40 } from './catalogue/p40';
import { p41 } from './catalogue/p41';
import { p42 } from './catalogue/p42';
import { p43 } from './catalogue/p43';
import { p44 } from './catalogue/p44';
import { p45 } from './catalogue/p45';
import { p46 } from './catalogue/p46';
import { p47 } from './catalogue/p47';
import { p48 } from './catalogue/p48';
import { p49 } from './catalogue/p49';
import { p50 } from './catalogue/p50';
import { p51 } from './catalogue/p51';
import { p52 } from './catalogue/p52';
import { p53 } from './catalogue/p53';
import { p54 } from './catalogue/p54';
import { p55 } from './catalogue/p55';
import { p56 } from './catalogue/p56';
import { p57 } from './catalogue/p57';
import { p58 } from './catalogue/p58';
import { p59 } from './catalogue/p59';
import { p60 } from './catalogue/p60';
import { p61 } from './catalogue/p61';
import { p62 } from './catalogue/p62';
import { p63 } from './catalogue/p63';
import { p64 } from './catalogue/p64';
import { p65 } from './catalogue/p65';
import { i01 } from './catalogue/i01';
import { i02 } from './catalogue/i02';
import { i03 } from './catalogue/i03';
import { i04 } from './catalogue/i04';
import { i05 } from './catalogue/i05';
import { i06 } from './catalogue/i06';
import { i07 } from './catalogue/i07';
import { i08 } from './catalogue/i08';
import { i09 } from './catalogue/i09';
import { i10 } from './catalogue/i10';
import { i11 } from './catalogue/i11';
import { i12 } from './catalogue/i12';
import { i13 } from './catalogue/i13';
import { i14 } from './catalogue/i14';
import { i15 } from './catalogue/i15';
import { i16 } from './catalogue/i16';
import { i17 } from './catalogue/i17';
import { i18 } from './catalogue/i18';
import { i19 } from './catalogue/i19';
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
  p26,
  p27,
  p28,
  p29,
  p30,
  p31,
  p32,
  p33,
  p34,
  p35,
  p36,
  p37,
  p38,
  p39,
  p40,
  p41,
  p42,
  p43,
  p44,
  p45,
  p46,
  p47,
  p48,
  p49,
  p50,
  p51,
  p52,
  p53,
  p54,
  p55,
  p56,
  p57,
  p58,
  p59,
  p60,
  p61,
  p62,
  p63,
  p64,
  p65,
  i01,
  i02,
  i03,
  i04,
  i05,
  i06,
  i07,
  i08,
  i09,
  i10,
  i11,
  i12,
  i13,
  i14,
  i15,
  i16,
  i17,
  i18,
  i19,
];
