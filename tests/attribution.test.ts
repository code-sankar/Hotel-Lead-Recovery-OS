import { describe, expect, it } from 'vitest';
import { partitionByFollowUp, type ConvertedLeadRow } from '@/lib/analytics/metrics';

/**
 * Revenue attribution is the number a hotel owner will judge the product on,
 * so the rule is tested directly: a conversion is only "recovered" when an
 * automated follow-up demonstrably reached the guest before they booked.
 */

function lead(id: string, value: number, convertedAt: string | null): ConvertedLeadRow {
  return { id, conversion_value: value, converted_at: convertedAt };
}

describe('partitionByFollowUp', () => {
  it('counts a conversion that followed a sent follow-up as recovered', () => {
    const result = partitionByFollowUp(
      [lead('a', 5600, '2026-09-08T12:00:00Z')],
      new Map([['a', ['2026-09-08T10:00:00Z']]]),
    );
    expect(result.recovered.map((l) => l.id)).toEqual(['a']);
    expect(result.direct).toHaveLength(0);
  });

  it('does not count a conversion that happened before the follow-up went out', () => {
    const result = partitionByFollowUp(
      [lead('a', 5600, '2026-09-08T09:00:00Z')],
      new Map([['a', ['2026-09-08T10:00:00Z']]]),
    );
    expect(result.recovered).toHaveLength(0);
    expect(result.direct.map((l) => l.id)).toEqual(['a']);
  });

  it('does not count a lead that was never followed up', () => {
    const result = partitionByFollowUp([lead('a', 5600, '2026-09-08T12:00:00Z')], new Map());
    expect(result.recovered).toHaveLength(0);
    expect(result.direct).toHaveLength(1);
  });

  it('does not treat a scheduled-but-unsent follow-up as recovery', () => {
    // Only `follow_up_sent` events reach this map; an empty list is what a
    // merely-scheduled follow-up produces.
    const result = partitionByFollowUp([lead('a', 5600, '2026-09-08T12:00:00Z')], new Map([['a', []]]));
    expect(result.recovered).toHaveLength(0);
  });

  it('treats a conversion at the exact moment of the follow-up as recovered', () => {
    const at = '2026-09-08T10:00:00Z';
    const result = partitionByFollowUp([lead('a', 100, at)], new Map([['a', [at]]]));
    expect(result.recovered).toHaveLength(1);
  });

  it('ignores a lead with no conversion timestamp', () => {
    const result = partitionByFollowUp(
      [lead('a', 5600, null)],
      new Map([['a', ['2026-09-08T10:00:00Z']]]),
    );
    expect(result.recovered).toHaveLength(0);
    expect(result.direct).toHaveLength(1);
  });

  it('splits a mixed batch and keeps the totals separable', () => {
    const leads = [
      lead('recovered-1', 5600, '2026-09-08T12:00:00Z'),
      lead('recovered-2', 8400, '2026-09-09T12:00:00Z'),
      lead('direct-1', 2800, '2026-09-08T12:00:00Z'),
    ];
    const events = new Map([
      ['recovered-1', ['2026-09-08T10:00:00Z']],
      ['recovered-2', ['2026-09-09T10:00:00Z']],
    ]);

    const { recovered, direct } = partitionByFollowUp(leads, events);
    const sum = (rows: ConvertedLeadRow[]) =>
      rows.reduce((total, row) => total + Number(row.conversion_value ?? 0), 0);

    expect(sum(recovered)).toBe(14_000);
    expect(sum(direct)).toBe(2800);
    expect(sum(recovered) + sum(direct)).toBe(16_800);
  });

  it('ignores an unparseable follow-up timestamp rather than crediting it', () => {
    const result = partitionByFollowUp(
      [lead('a', 100, '2026-09-08T12:00:00Z')],
      new Map([['a', ['not-a-date']]]),
    );
    expect(result.recovered).toHaveLength(0);
  });
});
