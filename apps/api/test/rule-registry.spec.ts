import type { ObjectLiteral } from 'typeorm';
import { describe, expect, it } from 'vitest';
import type {
  RegisteredRule,
  RuleContext,
  RuleFunction,
  RuleResponse,
} from '../src/rules/rule-contract';
import {
  InvalidRuleResponseError,
  RuleRegistry,
  UnregisteredRuleError,
} from '../src/rules/rule-registry';

/**
 * The registry on its own: no database, no Nest container, and fake rules
 * throughout. Real rules are not this body of work, and the registry has no
 * opinion about what a rule does — only about which code a key resolves to and
 * what a response is allowed to look like.
 */

/** A row as the stub context serves it, in the shape a raw query returns. */
interface StubRow {
  legacy_id: string;
  phone: string;
}

/**
 * A context that answers `query` and `find` from a fixed list of rows. Enough
 * for a fake rule to produce a response that depends on what it read, so a
 * registry that resolved the wrong function, or never called it, cannot pass.
 */
function stubContext(rows: readonly StubRow[]): RuleContext {
  return {
    find<Entity extends ObjectLiteral>(): Promise<Entity[]> {
      return Promise.resolve(rows as unknown as Entity[]);
    },
    query<Row = unknown>(): Promise<Row[]> {
      return Promise.resolve(rows as unknown as Row[]);
    },
  };
}

/** `count` rows, each with a Dutch phone number written the old way. */
function stubRows(count: number): StubRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    legacy_id: `P-${index + 1}`,
    phone: `06${String(index + 1).padStart(8, '0')}`,
  }));
}

/**
 * A fake rule that reads every row it is given and proposes a correction on the
 * named column — one update per row, in one response.
 */
function fakeColumnRule(column: string): RuleFunction {
  return async (context: RuleContext): Promise<RuleResponse> => {
    const rows = await context.query<StubRow>(`SELECT legacy_id, phone FROM legacy_patient`);

    return {
      ambiguity: false,
      updates: rows.map((row) => ({
        table: 'patient' as const,
        legacyId: row.legacy_id,
        column,
        prev: row.phone,
        next: `+31${row.phone.slice(1)}`,
      })),
    };
  };
}

/** A fake rule that finds a problem it cannot fix (1.1.12). */
const fakeAmbiguousRule: RuleFunction = async (context: RuleContext) => {
  const rows = await context.query<StubRow>(`SELECT legacy_id, phone FROM legacy_patient`);

  return {
    ambiguity: true,
    updates: rows.map((row) => ({
      table: 'patient' as const,
      legacyId: row.legacy_id,
      column: 'phone',
      prev: row.phone,
      next: null,
    })),
  };
};

describe('the rule registry', () => {
  const emptyContext = stubContext([]);

  it('resolves code by the (ruleId, version) key', async () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('phone') },
    ]);

    const response = await registry.get('R-FAKE', 1)(stubContext(stubRows(1)));

    // The function that comes back is asked what it does, not merely compared
    // by identity: a registry that stored the right key against the wrong
    // function would pass an identity check against its own map.
    expect(response.updates).toEqual([
      {
        table: 'patient',
        legacyId: 'P-1',
        column: 'phone',
        prev: '0600000001',
        next: '+31600000001',
      },
    ]);
  });

  it('keeps every version of a rule resolvable, each to its own code', async () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('phone') },
      { ruleId: 'R-FAKE', version: 2, run: fakeColumnRule('mobile') },
    ]);

    const context = stubContext(stubRows(1));
    const first = await registry.get('R-FAKE', 1)(context);
    const second = await registry.get('R-FAKE', 2)(context);

    // Version 1's code still runs after version 2 exists. The rule rows already
    // written name version 1, and the modification log reads them (1.1.1, 1.3),
    // so the old code stays reachable forever.
    expect(first.updates.map((update) => update.column)).toEqual(['phone']);
    expect(second.updates.map((update) => update.column)).toEqual(['mobile']);
  });

  it('throws on a ruleId nothing is registered for, naming the key it wanted', () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('phone') },
    ]);

    let thrown: unknown;

    try {
      registry.get('R-ABSENT', 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnregisteredRuleError);
    expect((thrown as UnregisteredRuleError).ruleId).toBe('R-ABSENT');
    expect((thrown as UnregisteredRuleError).version).toBe(1);
    expect((thrown as UnregisteredRuleError).message).toContain('R-ABSENT');
    expect((thrown as UnregisteredRuleError).message).toContain('version 1');
  });

  it('throws on a version it has no code for rather than falling back to another', () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('phone') },
      { ruleId: 'R-FAKE', version: 2, run: fakeColumnRule('mobile') },
    ]);

    // Never the nearest version, never the latest: a finding recorded under a
    // version whose code did not produce it misattributes the change the
    // modification log points at (1.3).
    expect(() => registry.get('R-FAKE', 3)).toThrow(UnregisteredRuleError);
    expect(() => registry.get('R-FAKE', 0)).toThrow(UnregisteredRuleError);
  });

  it('refuses a catalogue that registers one key twice', () => {
    const catalogue: RegisteredRule[] = [
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('phone') },
      { ruleId: 'R-FAKE', version: 1, run: fakeColumnRule('mobile') },
    ];

    // A second entry must not quietly shadow the code the first one named.
    expect(() => new RuleRegistry(catalogue)).toThrow(/already registered/);
  });

  it('calls a rule once and takes 340 changes back in a single response', async () => {
    let calls = 0;
    const countingRule: RuleFunction = async (context) => {
      calls += 1;
      return fakeColumnRule('phone')(context);
    };

    const registry = new RuleRegistry([{ ruleId: 'R-PHONE', version: 1, run: countingRule }]);

    const response = await registry.run('R-PHONE', 1, stubContext(stubRows(340)));

    // 1.1.14: called exactly once, not once per row, and every change it found
    // comes back together.
    expect(calls).toBe(1);
    expect(response.updates).toHaveLength(340);
    expect(response.updates[0]).toEqual({
      table: 'patient',
      legacyId: 'P-1',
      column: 'phone',
      prev: '0600000001',
      next: '+31600000001',
    });
    expect(response.updates[339]?.legacyId).toBe('P-340');
    expect(response.ambiguity).toBe(false);
  });

  it('carries table, legacyId, column, prev and next on every one of those changes', async () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-PHONE', version: 1, run: fakeColumnRule('phone') },
    ]);

    const response = await registry.run('R-PHONE', 1, stubContext(stubRows(340)));

    // 1.1.7's shape, and there is no second one.
    for (const update of response.updates) {
      expect(Object.keys(update).sort()).toEqual(['column', 'legacyId', 'next', 'prev', 'table']);
      expect(update.table).toBe('patient');
      expect(update.legacyId).toMatch(/^P-\d+$/);
      expect(update.column).toBe('phone');
      expect(typeof update.prev).toBe('string');
      expect(typeof update.next).toBe('string');
    }
  });

  it('accepts an ambiguous response, every update carrying a prev and no next', async () => {
    const registry = new RuleRegistry([
      { ruleId: 'R-AMBIGUOUS', version: 1, run: fakeAmbiguousRule },
    ]);

    const response = await registry.run('R-AMBIGUOUS', 1, stubContext(stubRows(3)));

    // An ambiguous rule's findings are legitimate findings (1.1.12): the human
    // reads the rule's description in place of a proposed value.
    expect(response.ambiguity).toBe(true);
    expect(response.updates).toEqual([
      { table: 'patient', legacyId: 'P-1', column: 'phone', prev: '0600000001', next: null },
      { table: 'patient', legacyId: 'P-2', column: 'phone', prev: '0600000002', next: null },
      { table: 'patient', legacyId: 'P-3', column: 'phone', prev: '0600000003', next: null },
    ]);
  });

  it('rejects an ambiguous response that still proposes a value', async () => {
    const smugglingRule: RuleFunction = async () => ({
      ambiguity: true,
      updates: [
        {
          table: 'patient' as const,
          legacyId: 'P-1',
          column: 'phone',
          prev: '0600000001',
          next: null,
        },
        {
          table: 'patient' as const,
          legacyId: 'P-2',
          column: 'phone',
          prev: '0600000002',
          next: '+3100000002',
        },
      ],
    });

    const registry = new RuleRegistry([{ ruleId: 'R-SMUGGLE', version: 1, run: smugglingRule }]);

    // 1.1.14 states it in words: when ambiguity is true, every update carries a
    // prev and no next. One update with a value breaks the whole response.
    await expect(registry.run('R-SMUGGLE', 1, emptyContext)).rejects.toBeInstanceOf(
      InvalidRuleResponseError,
    );
  });

  it('leaves a valid response exactly as the rule returned it', async () => {
    const response: RuleResponse = {
      ambiguity: false,
      updates: [
        { table: 'intake', legacyId: 'I-9', column: 'legacy_patient_id', prev: null, next: 'P-3' },
      ],
    };
    const registry = new RuleRegistry([
      { ruleId: 'R-LINK', version: 1, run: async () => response },
    ]);

    const returned = await registry.run('R-LINK', 1, emptyContext);

    // Nothing is normalised, filled in or dropped on the way through. The
    // persistence layer (1.1.3) reads what the rule said.
    expect(returned).toBe(response);
  });

  it('resolves nothing at all when the catalogue is empty', () => {
    const registry = new RuleRegistry([]);

    expect(() => registry.get('R-FAKE', 1)).toThrow(UnregisteredRuleError);
  });
});
