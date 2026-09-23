import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { LANGUAGES, coverage } from '../../src/i18n/strings';
import { useLanguage } from '../../src/providers/language';
import { useTheme } from '../../src/theme';
import { Card, Screen, SectionTitle } from '../../src/components/ui';

/**
 * Language (Phase 8, v2.84). Saved on this phone, like the theme, so one
 * person's choice is their own. Each language names itself in its own script -
 * somebody looking for Punjabi is looking for ਪੰਜਾਬੀ, not for "Punjabi".
 */
export default function LanguageSettingsScreen() {
  const { lang, setLang, t } = useLanguage();
  const { c, spacing } = useTheme();

  return (
    <Screen scroll>
      <SectionTitle>{t('language.title')}</SectionTitle>
      <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
        {t('language.subtitle')}
      </Text>

      <Card style={{ padding: 0, marginBottom: spacing.lg }}>
        {LANGUAGES.map((option, i) => {
          const active = lang === option.code;
          const done = coverage(option.code);
          return (
            <Pressable
              key={option.code}
              onPress={() => setLang(option.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: i === LANGUAGES.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
                  {option.native}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                  {option.label}
                  {option.code === 'en' ? '' : ` · ${done.percent}%`}
                </Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={22} color={c.brand} /> : null}
            </Pressable>
          );
        })}
      </Card>

      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 18 }}>{t('language.partial')}</Text>
    </Screen>
  );
}
