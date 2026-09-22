import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTabletLayout } from '../lib/tablet-layout';
import { useTheme } from '../theme';
import { EmptyState, type IconName } from './ui';

/**
 * List on the left, the chosen item on the right (Phase 7, v2.83).
 *
 * Used only at tablet width; a phone keeps its list and pushes the item as a
 * screen of its own, as it always has. The detail pane is keyed by the item,
 * so choosing another starts it fresh rather than carrying one item's
 * half-typed comment or open sheet over to the next.
 */
export function MasterDetail({
  list,
  detail,
  detailKey,
  placeholder,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  detailKey: string | null;
  placeholder: { icon: IconName; title: string; message: string };
}) {
  const { listWidth } = useTabletLayout();
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.background }}>
      <View style={{ width: listWidth, borderRightWidth: 1, borderRightColor: c.border }}>
        {list}
      </View>
      <View style={{ flex: 1 }} key={detailKey ?? 'none'}>
        {detail ?? (
          <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
            <EmptyState
              icon={placeholder.icon}
              title={placeholder.title}
              message={placeholder.message}
            />
          </View>
        )}
      </View>
    </View>
  );
}
