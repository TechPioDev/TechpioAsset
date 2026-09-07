import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { filterOptions, hiddenCount, shouldFilter } from '../lib/pick-options';
import { useTheme } from '../theme';

/**
 * Choosing one of a list, on a phone (v2.45).
 *
 * Chips rather than a dropdown, matching the receiving screen: on a small
 * screen a native picker hides every option but one behind a tap, and choosing
 * a category is easier when the choices are simply on screen.
 *
 * Past a dozen or so that stops being true - a company with fifty suppliers
 * gets a wall of chips as the first thing on the form - so above the threshold
 * this filters instead. Same control, two behaviours, decided by the data
 * rather than by each caller remembering to pass a flag.
 */

export function ChipPicker<T extends { id: string; name: string }>({
  options,
  value,
  onChange,
  label,
  allowNone,
  noneLabel = 'Not specified',
}: {
  options: T[];
  value: string;
  onChange: (id: string) => void;
  /** Announced to screen readers, e.g. "Category". */
  label: string;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const { c, radius, spacing } = useTheme();
  const [query, setQuery] = useState('');
  const filtering = shouldFilter(options.length);

  const shown = useMemo(() => filterOptions(options, query, value), [options, query, value]);

  const chip = (id: string, text: string) => {
    const chosen = id === value;
    return (
      <Pressable
        key={id || 'none'}
        onPress={() => onChange(id)}
        accessibilityRole="button"
        accessibilityState={{ selected: chosen }}
        accessibilityLabel={`${label}: ${text}`}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: chosen ? c.brand : c.border,
          backgroundColor: chosen ? c.brand : 'transparent',
        }}
      >
        <Text style={{ color: chosen ? c.brandText : c.text, fontSize: 13, fontWeight: '600' }}>
          {text}
        </Text>
      </Pressable>
    );
  };

  const hidden = hiddenCount(options.length, shown.length);

  return (
    <View>
      {filtering ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${label.toLowerCase()}`}
          placeholderTextColor={c.subtle}
          accessibilityLabel={`Search ${label}`}
          style={{
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            color: c.text,
            borderRadius: radius.md,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 14,
            marginBottom: spacing.sm,
          }}
        />
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {allowNone ? chip('', noneLabel) : null}
        {shown.map((option) => chip(option.id, option.name))}
      </View>

      {filtering && hidden > 0 ? (
        <Text style={{ color: c.subtle, fontSize: 11, marginTop: spacing.sm }}>
          {hidden} more — type above to narrow the list.
        </Text>
      ) : null}
      {filtering && shown.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.sm }}>
          Nothing matches “{query.trim()}”.
        </Text>
      ) : null}
    </View>
  );
}
