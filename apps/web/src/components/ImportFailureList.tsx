import { Alert, Table, Text } from '@mantine/core';
import type { FieldError } from '../api/types';
import { DiffValue, diffValues } from './ValueDiff';

/** A field error's own `value`, turned into the text `ValueDiff` draws (2.6: "value drawn with `ValueDiff`"). Anything not already a string is stringified — a field error's `value` can be a number, a boolean, a list, or null. */
function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface ImportFailureListProps {
  readonly errors: readonly FieldError[];
}

/**
 * One row's import failures (2.6): every field, its value, and the reason it
 * was refused — the same table shape for an individual import's 409/422 and
 * a bulk import's own per-row `errors` (`client.ts`'s `importPatientRow`
 * normalizes the individual route's plain-message 409 into this shape, so
 * one component renders both).
 *
 * There is nothing to diff here — a value that failed is shown as it is, not
 * against a proposal — so every value is drawn with `diffValues(text, text)`
 * (an unchanged "diff" against itself) purely for `ValueDiff`'s own
 * invisible-character handling, in the neutral `'plain'` tone the same way
 * an ambiguous rule's un-proposed value already is.
 */
export function ImportFailureList({ errors }: ImportFailureListProps) {
  return (
    <Alert color="red" title="This row could not be imported" p="sm">
      <Table.ScrollContainer minWidth={360}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Field</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th>Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {errors.map((error, index) => {
              const text = describeValue(error.value);
              const pieces = text === null ? null : diffValues(text, text).after;

              return (
                <Table.Tr key={`${error.field ?? 'row'}-${index}`}>
                  <Table.Td>
                    {error.field ?? (
                      <Text size="sm" c="dimmed" fs="italic">
                        (row)
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <DiffValue pieces={pieces} tone="plain" />
                  </Table.Td>
                  <Table.Td>{error.reason}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Alert>
  );
}
