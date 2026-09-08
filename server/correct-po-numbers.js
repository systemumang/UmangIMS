// One-time correction requested on 2026-09-08. PR numbers identify the original orders.
export const poNumberCorrections = [
  ['UC/PR/26-27/00147', 'GEN/PO/26-27/00007', 'UC/PO/26-27/00881'],
  ['UC/PR/26-27/00148', 'UC/PO/26-27/00881', 'UC/PO/26-27/00882'],
  ['UC/PR/26-27/00149', 'UC/PO/26-27/00882', 'UC/PO/26-27/00883'],
  ['UC/PR/26-27/00150', 'UC/PO/26-27/00883', 'UC/PO/26-27/00884'],
  ['UC/PR/26-27/00151', 'UC/PO/26-27/00884', 'UC/PO/26-27/00885'],
];

export function validateCorrectionRows(rows) {
  if (!rows.length) return 'absent';
  if (rows.length !== 5) throw new Error('PO correction: expected exactly five orders');
  const firmId = rows[0].firm_id;
  for (const [pr] of poNumberCorrections) {
    const matches = rows.filter(row => row.pr_number === pr);
    if (matches.length !== 1 || !firmId || matches[0].firm_id !== firmId || matches[0].sort_name !== 'UC') {
      throw new Error('PO correction: unexpected PR or firm');
    }
  }
  const matches = index => poNumberCorrections.every(mapping => rows.find(row => row.pr_number === mapping[0]).po_number === mapping[index]);
  if (matches(2)) return 'complete';
  if (matches(1)) return 'pending';
  throw new Error('PO correction: unexpected or partially changed numbers');
}

export async function correctPoNumbers(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT po.id, po.po_number, po.firm_id, pr.pr_number, f.sort_name
      FROM purchase_orders po JOIN purchase_requisitions pr ON pr.id = po.pr_id
      JOIN firms f ON f.id = po.firm_id WHERE pr.pr_number IN (?) FOR UPDATE`,
      [poNumberCorrections.map(mapping => mapping[0])]);
    const state = validateCorrectionRows(rows);
    if (state === 'absent') {
      await conn.commit();
      return state;
    }
    const firmId = rows[0].firm_id;
    await conn.query(`INSERT IGNORE INTO doc_sequences (firm_id, kind, fy, next_no) VALUES (?, 'PO', '26-27', 886)`, [firmId]);
    await conn.query(`SELECT next_no FROM doc_sequences WHERE firm_id = ? AND kind = 'PO' AND fy = '26-27' FOR UPDATE`, [firmId]);
    if (state === 'pending') {
      const [occupied] = await conn.query('SELECT id FROM purchase_orders WHERE po_number = ? FOR UPDATE', ['UC/PO/26-27/00885']);
      if (occupied.length) throw new Error('PO correction: target 00885 is already occupied');
      // Highest first frees each target before the preceding order is renamed.
      for (const [pr, oldNo, newNo] of [...poNumberCorrections].reverse()) {
        const row = rows.find(row => row.pr_number === pr);
        const [result] = await conn.query('UPDATE purchase_orders SET po_number = ?, updated_at = NOW() WHERE id = ? AND po_number = ?', [newNo, row.id, oldNo]);
        if (result.affectedRows !== 1) throw new Error('PO correction: order changed concurrently');
      }
    }
    await conn.query(`UPDATE doc_sequences SET next_no = GREATEST(next_no, 886) WHERE firm_id = ? AND kind = 'PO' AND fy = '26-27'`, [firmId]);
    await conn.commit();
    return state === 'pending' ? 'corrected' : state;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
