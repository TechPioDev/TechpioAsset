import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTheme } from '../../theme';
import { SheetShell } from '../sheet-shell';

/**
 * The bottom sheet the asset-administration actions open in - the same shell
 * as the handover sheet (title, subtitle, close, scrolling body), kept in one
 * place so transfer and disposal look like the rest of the asset page.
 */
export function AssetSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // U2 - the chrome moved to SheetShell, which added the grabber, the
  // swipe-down and the fading backdrop. Every sheet that goes through here -
  // transfer, disposal, saved scans, the stock count - got them at once.
  return (
    <SheetShell visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      {children}
    </SheetShell>
  );
}

/** A small bold label above a chip row, matching the Field label style. */
export function FormLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{children}</Text>;
}
