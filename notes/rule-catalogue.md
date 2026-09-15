# Rule catalogue — first draft

Written from `EXPORT-NOTES.md` and ordinary assumptions about data of this kind.
Nobody has looked at the actual values yet, on purpose — this is what we would
expect to find, not what is there.

Not prioritised. Not ordered by likelihood. The ids are addresses.

Each rule obeys the constraints we settled:

- **Atomic** (1.1.4) — one rule, one fix.
- **Same column** (1.1.5) — a rule changes the column it tested.
- **Field-shaped** (1.1.7) — the finding is `(table, row, column, prev, next)`.
- **Ambiguity is rule-wide** (1.1.12) — a rule either fixes what it finds, or it
  does not. The ✱ column marks the ones that do not.

✱ = ambiguous: finds a problem, proposes no value, waits for a human.

---

## Patients

### legacy_id

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P01 | Leading or trailing whitespace | The trimmed id | |
| P02 | Empty or missing | — the row cannot be addressed at all | ✱ |

### full_name

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P03 | Leading, trailing or doubled internal whitespace | The cleaned name | |
| P04 | Written entirely in capitals or entirely in lower case | Title case, preserving Dutch particles (`van`, `de`, `der`, `ten`) | |
| P05 | Comma-inverted, `Berg, Jan van der` | `Jan van der Berg` | |
| P06 | Carries a title or salutation — `Dhr.`, `Mevr.`, `Mr`, `Drs.` | The name without it | |
| P07 | Holds an email address or a phone number instead of a name | — | ✱ |
| P08 | Empty | — | ✱ |
| P09 | A single token, so no surname at all | — | ✱ |

### email

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P10 | Whitespace, or mixed case in the domain | Trimmed and lower-cased | |
| P11 | A known provider typo — `gmial.com`, `hotmial.com`, `gmai.com` | The corrected domain, from a fixed list only | |
| P12 | No `@`, or otherwise not an address at all | — | ✱ |
| P13 | Two or more addresses in one cell, split by `/`, `;` or `,` | — which one is primary is a human call | ✱ |
| P14 | A placeholder — `test@test.com`, `noemail@`, `x@x.x` | — | ✱ |
| P15 | Empty, though `EXPORT-NOTES` says it was used as a login | — | ✱ |

### dob

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P16 | US-style `MM/DD/YYYY` where the day exceeds 12, so the order is certain | The ISO date | |
| P17 | `DD-MM-YYYY` or `DD.MM.YYYY`, unambiguous but not ISO | The ISO date | |
| P18 | A date where both parts are 12 or under, so US and European readings both parse | — this is the caveat the notes warn about, and it cannot be guessed | ✱ |
| P19 | A two-digit year | — `54` is 1954 or 2054 | ✱ |
| P20 | A date in the future | — | ✱ |
| P21 | An implied age under 18 or over 100 | — | ✱ |
| P22 | Empty | — | ✱ |

### sex

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P23 | A recognised spelling in any form — `M`, `m`, `Male`, `man`, `V`, `F`, `vrouw`, `Female` | The canonical value | |
| P24 | A value nobody recognises | — | ✱ |
| P25 | Empty | — | ✱ |

### bsn

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P26 | Spaces, dots or dashes inside the number | The digits alone | |
| P27 | Eight digits, which is a nine-digit BSN whose leading zero a spreadsheet ate | The zero-padded value | |
| P28 | Fails the Dutch eleven-proef checksum | — never validated, per the notes, so this is expected | ✱ |
| P29 | Contains letters, or is the wrong length after cleaning | — | ✱ |

### phone

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P30 | Spaces, dots, dashes or brackets | The digits and any leading `+` | |
| P31 | Starts `00` followed by a country code | `+` and that country code | |
| P32 | A national Dutch number starting `06` or `0` | `+31` form | |
| P33 | Too short or too long to be any phone number | — | ✱ |
| P34 | Contains letters, or an extension — `ext 12`, `tst` | — | ✱ |
| P35 | A placeholder — `000000000`, `123456789`, all one digit | — | ✱ |
| P36 | Empty | — | ✱ |

### city

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P37 | Whitespace, or casing that is not title case | The cleaned name | |
| P38 | A known alias — `A'dam`, `Den Bosch`, `s Gravenhage` | The canonical city, from a fixed list only | |
| P39 | Holds a postcode or a whole address rather than a city | — | ✱ |
| P40 | Empty | — | ✱ |

### weight

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P41 | A comma decimal — `82,5` | `82.5` | |
| P42 | The unit written into the value — `82 kg`, `180lbs` | The number alone | |
| P43 | Not a number at all | — | ✱ |
| P44 | A value implausible in either unit — under 30 or over 400 | — | ✱ |
| P45 | Empty | — | ✱ |

### weight_unit

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P46 | A recognised spelling — `KG`, `kgs`, `kilo`, `Kilogram`, `lb`, `lbs`, `pounds` | The canonical unit | |
| P47 | Empty while `weight` has a value — the backfill "where obvious" left the rest | — | ✱ |
| P48 | A unit nobody recognises | — | ✱ |

### height_cm

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P49 | A comma decimal | The dot form | |
| P50 | Expressed in metres — a value under 3 | The centimetre value | |
| P51 | Expressed in feet and inches — `5'10"`, `5 ft 10` | The centimetre value | |
| P52 | Not a number | — | ✱ |
| P53 | Implausible after cleaning — under 100 or over 250 | — | ✱ |
| P54 | Empty | — | ✱ |

### status

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P55 | A recognised spelling of active, paused, churned or prospect, in any case or language | The canonical value | |
| P56 | A value that maps to none of the four | — | ✱ |
| P57 | Empty | — | ✱ |

### signup_date

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P58 | US-style where the day exceeds 12 | The ISO date | |
| P59 | Unambiguous but not ISO | The ISO date | |
| P60 | Both parts 12 or under | — | ✱ |
| P61 | In the future | — | ✱ |
| P62 | Earlier than the patient's own `dob` | — | ✱ |
| P63 | Empty | — | ✱ |

### source

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| P64 | Whitespace or inconsistent casing | Trimmed and lower-cased | |
| P65 | Empty | — | ✱ |

---

## Intakes

### intake_id

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I01 | Whitespace | The trimmed id | |
| I02 | Empty | — | ✱ |

### legacy_patient_id

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I03 | Whitespace | The trimmed id | |
| I04 | References a patient that does not exist — the notes say the automation sometimes fired first | — | ✱ |
| I05 | Empty | — | ✱ |

### submitted_at

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I06 | US-style where the day exceeds 12 | The ISO date | |
| I07 | Unambiguous but not ISO | The ISO date | |
| I08 | Both parts 12 or under | — | ✱ |
| I09 | In the future | — | ✱ |
| I10 | Earlier than the patient's `signup_date` | — | ✱ |
| I11 | Empty | — | ✱ |

### questionnaire_version

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I12 | A recognised form written loosely — `V2`, `2`, `version 2`, `v2.0` | The canonical label | |
| I13 | A label matching no known version | — | ✱ |
| I14 | Empty | — | ✱ |

### weight and height

The same problems as the patient columns, and they need their own rules because
they are different columns on a different table. Self-reported at submission, so
differing from the patient row is **not** an error and no rule should flag it.

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I15 | `weight` with a comma decimal | The dot form | |
| I16 | `weight` with the unit written in | The number alone | |
| I17 | `weight` not a number | — | ✱ |
| I18 | `weight` implausible in either unit | — | ✱ |
| I19 | `weight` has no unit column here at all, unlike patients | — | ✱ |
| I20 | `height` with a comma decimal | The dot form | |
| I21 | `height` in metres | The centimetre value | |
| I22 | `height` in feet and inches | The centimetre value | |
| I23 | `height` not a number, or implausible | — | ✱ |

### meds_current

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I24 | Whitespace | The trimmed text | |
| I25 | A way of saying nothing — `none`, `geen`, `n/a`, `-`, `nvt`, `x` | One canonical empty marker | |
| I26 | Free text naming medication, never normalised | — normalising drug names is not a mechanical fix | ✱ |

### conditions

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I27 | Whitespace | The trimmed text | |
| I28 | A way of saying nothing | One canonical empty marker | |
| I29 | Free text, Dutch and English mixed | — | ✱ |

### alcohol_units_week

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I30 | A comma decimal | The dot form | |
| I31 | A range — `5-10`, `5 à 10` | — which end is meant is a human call | ✱ |
| I32 | Words rather than a number — `occasionally`, `soms`, `socially` | — | ✱ |
| I33 | Negative, or implausibly high | — | ✱ |
| I34 | Empty | — | ✱ |

### outcome

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I35 | A recognised spelling of approved, rejected or pending | The canonical value | |
| I36 | A value matching none of the three | — | ✱ |
| I37 | Empty | — | ✱ |

### reviewer_note

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| I38 | Whitespace | The trimmed text | |

---

## Consents

### patient_legacy_id

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| C01 | Whitespace | The trimmed id | |
| C02 | References a patient that does not exist | — | ✱ |
| C03 | Empty | — | ✱ |

### type

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| C04 | Anything other than `data_processing`, which is all the notes say exists | — | ✱ |

### action

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| C05 | A recognised spelling of granted or revoked | The canonical value | |
| C06 | Neither | — | ✱ |

### at

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| C07 | Not ISO, but unambiguous | The ISO timestamp | |
| C08 | A date with no time at all | — | ✱ |
| C09 | In the future | — | ✱ |
| C10 | Before the patient's `signup_date` | — | ✱ |
| C11 | Empty | — | ✱ |

### version

| id | Catches | Proposes | ✱ |
|---|---|---|---|
| C12 | A recognised form written loosely — `V2`, `2`, `v2.0` | The canonical label | |
| C13 | Empty | — | ✱ |

---

## Duplicates

These write to the duplicates table, not to a column (1.1.13). The notes say
outright that people signed up twice with different emails.

| id | Catches |
|---|---|
| D01 | Two patients with the same normalised email |
| D02 | Two patients with the same BSN, once cleaned |
| D03 | Two patients with the same normalised name and the same `dob` |
| D04 | Two patients with the same normalised phone |
| D05 | Two intakes with the same `intake_id` |
| D06 | Two consent events identical in patient, type, action, timestamp and version |

**v2 of all six** names both data rows as well as both legacy ids (1.7.1). v1 of
D05 and D06 named the same legacy id twice — two intakes share an intake id, two
consent events share a patient id — so the link could not say which row is X.

---

## Merges

Fill a column of Y that is empty from a confirmed duplicate X of it (1.7.7).
Patients only. Facts about the person merge; facts about a signup (`signup_date`,
`source`, `status`, `weight`, `height_cm`) do not.

| id | Column | Proposes | ✱ |
|---|---|---|---|
| M01 | `full_name` | X's value, when Y's is empty | |
| M02 | `email` | X's value, when Y's is empty | |
| M03 | `dob` | X's value, when Y's is empty | |
| M04 | `sex` | X's value, when Y's is empty | |
| M05 | `bsn` | X's value, when Y's is empty | |
| M06 | `phone` | X's value, when Y's is empty | |
| M07 | `city` | X's value, when Y's is empty | |

Two confirmed duplicates of Y holding different values for the column: that row
proposes nothing.

---

## One constraint this catalogue cannot satisfy

**Converting pounds to kilograms breaks 1.1.5.**

The notes are explicit that an early campaign offered a pounds option, so
somewhere there are weights in pounds. The fix reads `weight_unit` and writes
`weight` — it tests one column and changes another, which 1.1.5 forbids and
1.1.4 forbids splitting across two columns in one rule.

Three ways out, none of them chosen:

1. The rule tests `weight` alone and infers the unit from the value — anything
   over ~200 is pounds. Obeys the constraint, but guesses.
2. Let the conversion be two rules that must both be approved, in order. Breaks
   atomicity in practice even if not in form.
3. Relax 1.1.5 so a rule may read anything and change one named column. The
   self-terminating property we relied on then has to come from somewhere else.

Nothing in the catalogue above depends on the answer, so it can wait — but
P41–P48 are incomplete until it is settled.
