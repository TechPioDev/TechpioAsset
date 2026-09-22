import { useWindowDimensions } from 'react-native';
import { gridColumns, isTabletWidth, listPaneWidth } from './tablet-layout-rules';

export * from './tablet-layout-rules';

/** The window's current layout: two columns from tablet width up. */
export function useTabletLayout(): {
  tablet: boolean;
  width: number;
  listWidth: number;
  columns: number;
} {
  const { width } = useWindowDimensions();
  return {
    tablet: isTabletWidth(width),
    width,
    listWidth: listPaneWidth(width),
    columns: gridColumns(width),
  };
}
