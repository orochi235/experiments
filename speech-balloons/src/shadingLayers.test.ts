import { describe, it, expect } from 'vitest';
import { groupShadingItems, NON_LIGHT_GROUPS } from './shadingLayers';
import type { ShadingItem } from './types';

const items: ShadingItem[] = [
  { id: 'body', label: 'Body fill', group: 'body' },
  { id: 'dome.key', label: 'Key light', group: 'dome' },
  { id: 'dome.fill', label: 'Fill light', group: 'dome' },
  { id: 'aqua.body', label: 'Aqua body', group: 'aqua' },
  { id: 'bevel', label: 'Bevel band', group: 'bevel' },
];

describe('groupShadingItems', () => {
  it('groups items by their group, preserving input order within a group', () => {
    const grouped = groupShadingItems(items, { hideNonLight: false });
    expect(grouped.map((g) => g.group)).toEqual(['body', 'dome', 'aqua', 'bevel']);
    expect(grouped.find((g) => g.group === 'dome')!.items.map((i) => i.id)).toEqual(['dome.key', 'dome.fill']);
  });

  it('hideNonLight removes body, aqua, bevel groups', () => {
    const grouped = groupShadingItems(items, { hideNonLight: true });
    expect(grouped.map((g) => g.group)).toEqual(['dome']);
  });

  it('NON_LIGHT_GROUPS contains exactly body, aqua, bevel', () => {
    expect(new Set(NON_LIGHT_GROUPS)).toEqual(new Set(['body', 'aqua', 'bevel']));
  });
});
