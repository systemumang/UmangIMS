import test from 'node:test';
import assert from 'node:assert/strict';
import { correctPoNumbers, poNumberCorrections } from '../server/correct-po-numbers.js';

function database({ complete = false, occupied = false, failAt = 0 } = {}) {
  let rows = poNumberCorrections.map((m, i) => ({ id: String(i), pr_number: m[0], po_number: m[complete ? 2 : 1], firm_id: 'uc', sort_name: 'UC' }));
  let snapshot;
  let writes = 0;
  let rolledBack = false;
  const conn = {
    async beginTransaction() { snapshot = structuredClone(rows); },
    async commit() {},
    async rollback() { rows = snapshot; rolledBack = true; },
    release() {},
    async query(sql, args) {
      if (sql.includes('FROM purchase_orders po JOIN')) return [structuredClone(rows)];
      if (sql.startsWith('SELECT id')) return [occupied ? [{ id: 'other' }] : []];
      if (sql.startsWith('UPDATE purchase_orders')) {
        if (++writes === failAt) throw new Error('simulated write failure');
        assert.ok(!rows.some(row => row.po_number === args[0]), 'no duplicate number');
        const row = rows.find(row => row.id === args[1] && row.po_number === args[2]);
        if (row) row.po_number = args[0];
        return [{ affectedRows: row ? 1 : 0 }];
      }
      assert.equal(args[0], 'uc', 'sequence scoped to UC');
      return [[]];
    },
  };
  return { getConnection: async () => conn, rows: () => rows, writes: () => writes, rolledBack: () => rolledBack };
}

test('renumbers all five without collisions and reruns without further renaming', async () => {
  const db = database();
  assert.equal(await correctPoNumbers(db), 'corrected');
  assert.deepEqual(db.rows().map(row => row.po_number), poNumberCorrections.map(m => m[2]));
  assert.equal(await correctPoNumbers(db), 'complete');
  assert.equal(db.writes(), 5);
});
test('occupied target aborts before any PO writes', async () => {
  const db = database({ occupied: true });
  await assert.rejects(correctPoNumbers(db), /occupied/);
  assert.equal(db.writes(), 0);
  assert.ok(db.rolledBack());
});
test('failure midway rolls back every renamed order', async () => {
  const db = database({ failAt: 3 });
  await assert.rejects(correctPoNumbers(db), /simulated/);
  assert.deepEqual(db.rows().map(row => row.po_number), poNumberCorrections.map(m => m[1]));
});
test('partial or unexpected state is refused', async () => {
  const db = database();
  db.rows()[0].po_number = 'unexpected';
  await assert.rejects(correctPoNumbers(db), /unexpected/);
  assert.equal(db.writes(), 0);
});
