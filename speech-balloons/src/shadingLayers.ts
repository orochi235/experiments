import type { ShadingGroup, ShadingItem } from './types';

export const NON_LIGHT_GROUPS: readonly ShadingGroup[] = ['body', 'aqua', 'bevel'];

export interface GroupedShading {
  group: ShadingGroup;
  items: ShadingItem[];
}

export function groupShadingItems(
  items: readonly ShadingItem[],
  opts: { hideNonLight: boolean },
): GroupedShading[] {
  const hide = new Set<ShadingGroup>(opts.hideNonLight ? NON_LIGHT_GROUPS : []);
  const out: GroupedShading[] = [];
  const byGroup = new Map<ShadingGroup, ShadingItem[]>();
  for (const item of items) {
    if (hide.has(item.group)) continue;
    let bucket = byGroup.get(item.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(item.group, bucket);
      out.push({ group: item.group, items: bucket });
    }
    bucket.push(item);
  }
  return out;
}
