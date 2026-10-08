import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import { ContradictionMatrix, MATRIX } from '../../bos/domain/contradiction/matrix.js';

describe('Contradiction matrix (Altshuller 39x39)', () => {
  it('has 39 rows of exactly 39 cells with p leading empties', () => {
    assert.equal(MATRIX.length, 39);
    for (let p = 1; p <= 39; p++) {
      const row = MATRIX[p - 1]!;
      assert.equal(row.length, 39, `row ${p} must have 39 cells`);
      for (let w = 1; w <= p; w++) {
        assert.deepEqual(row[w - 1], [], `row ${p} cell ${w} must be empty (upper triangular)`);
      }
      for (let w = p + 1; w <= 39; w++) {
        for (const n of row[w - 1]!) {
          assert.ok(Number.isInteger(n) && n >= 1 && n <= 40, `row ${p} col ${w}: principle ${n} out of range`);
        }
      }
    }
  });

  it('returns the verified canonical Altshuller cells', () => {
    const m = ContradictionMatrix.getInstance();
    const cases: Array<[number, number, number[]]> = [
      [1, 3, [15, 8, 29, 34]],
      [1, 5, [29, 17, 38, 34]],
      [9, 10, [13, 28, 15, 19]],
      [9, 19, [8, 15, 35, 38]],
      [19, 22, [12, 22, 15, 24]],
      [22, 25, [10, 18, 32, 7]],
      [22, 26, [7, 18, 25]],
      [22, 27, [11, 10, 35]],
    ];
    for (const [i, w, expected] of cases) {
      assert.deepEqual([...m.lookup(i, w)], expected, `cell ${i},${w}`);
    }
  });

  it('returns an empty list for cells Altshuller leaves blank', () => {
    const m = ContradictionMatrix.getInstance();
    const blanks: Array<[number, number]> = [[1, 2], [19, 20], [20, 21], [20, 22]];
    for (const [i, w] of blanks) {
      assert.deepEqual(m.lookup(i, w), [], `cell ${i},${w} should be empty`);
    }
  });

  it('reads the upper triangle for reversed pairs', () => {
    const m = ContradictionMatrix.getInstance();
    assert.deepEqual([...m.lookup(22, 19)], [12, 22, 15, 24]);
  });

  it('rejects out-of-range parameters', () => {
    const m = ContradictionMatrix.getInstance();
    assert.throws(() => m.lookup(0, 1), RangeError);
    assert.throws(() => m.lookup(1, 40), RangeError);
  });
});
