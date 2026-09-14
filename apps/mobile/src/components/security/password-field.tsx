import { useState } from 'react';
import { Pressable, Text, type TextInputProps } from 'react-native';
import { useTheme } from '../../theme';
import { Field } from '../ui';

/**
 * A password box: always secureTextEntry until the person asks to see it,
 * never auto-corrected or auto-capitalised (both would leak the value into the
 * keyboard's suggestion history), and "Show" resets when the field unmounts.
 */
export function PasswordField({
  label,
  newPassword = false,
  ...props
}: { label: string; newPassword?: boolean } & Omit<
  TextInputProps,
  'secureTextEntry' | 'autoCorrect' | 'autoCapitalize' | 'autoComplete' | 'textContentType'
>) {
  const { c } = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      labelRight={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          <Text style={{ color: c.brand, fontSize: 12, fontWeight: '700' }}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      }
      secureTextEntry={!visible}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      autoComplete={newPassword ? 'new-password' : 'current-password'}
      textContentType={newPassword ? 'newPassword' : 'password'}
      {...props}
    />
  );
}

/** A 6-digit authenticator code box. */
export function CodeField({
  label = '6-digit code',
  value,
  onChangeText,
  ...props
}: { label?: string; value: string; onChangeText: (v: string) => void } & Omit<
  TextInputProps,
  'value' | 'onChangeText'
>) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={6}
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      placeholder="123456"
      {...props}
    />
  );
}
