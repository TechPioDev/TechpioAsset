import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../theme';

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
  const { c, spacing } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}
      >
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '92%',
            paddingBottom: spacing.xl,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{title}</Text>
              {subtitle ? (
                <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A small bold label above a chip row, matching the Field label style. */
export function FormLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{children}</Text>;
}
