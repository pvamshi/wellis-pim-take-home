import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/**
 * One line of a source file: the parsed record, and the line it was parsed
 * from. The second half is what lands in `rawData`, so it is carried alongside
 * the first rather than reconstructed afterwards — a re-serialised record is
 * not the source row.
 */
export interface SourceRecord {
  /** Export column (or JSON key) -> value, exactly as the file wrote it. */
  readonly record: Readonly<Record<string, unknown>>;
  /** The source line, with only its trailing line terminator removed. */
  readonly raw: string;
}

/**
 * The export's CSVs are CRLF, and `csv-parse` hands back a raw string that has
 * lost the `\n` but kept the `\r`. JSONL lines are split on the terminator and
 * so carry none. One strip covers both, and removes exactly one terminator:
 * a value that genuinely ends in a newline keeps everything before it.
 */
function withoutTrailingLineTerminator(line: string): string {
  return line.replace(/\r\n$|\n$|\r$/, '');
}

/**
 * Reads a whole CSV file. Nothing is trimmed, cast or coerced — the schema
 * stores and rules interpret — so `trim`, `cast` and `relax_column_count` all
 * stay at their defaults. That last one matters: a row whose field count
 * disagrees with the header throws here rather than landing half-populated.
 */
export function readCsv(path: string): SourceRecord[] {
  const text = readFileSync(path, 'utf8');

  return parse<{ record: Record<string, string>; raw: string }>(text, {
    columns: true,
    bom: true,
    raw: true,
  }).map(({ record, raw }) => ({ record, raw: withoutTrailingLineTerminator(raw) }));
}

/**
 * Reads a whole JSONL file, one object per line. Blank lines — including the
 * one a trailing newline leaves behind — are not records and are dropped. A
 * line that will not parse names itself in the error rather than being skipped:
 * a run that silently read fewer rows than the file holds would report counts
 * that reconcile and still be wrong.
 */
export function readJsonl(path: string): SourceRecord[] {
  const text = readFileSync(path, 'utf8');
  const records: SourceRecord[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new Error(`${path} line ${index + 1} is not valid JSON`, { cause });
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${path} line ${index + 1} is not a JSON object`);
    }

    records.push({ record: parsed as Record<string, unknown>, raw: line });
  });

  return records;
}
