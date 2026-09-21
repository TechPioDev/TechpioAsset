import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Card, PullRefresh, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

interface AiConfig {
  globallyEnabled: boolean;
  providerName: string | null;
  humanReviewRequired: boolean;
  automaticFinancialApproval: boolean;
  featureModes: Record<string, string> | null;
}

export default function SettingsScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request<{ config: AiConfig }>('/ai-config');
      setConfig((res as { config?: AiConfig })?.config ?? (res as unknown as AiConfig));
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const modes = config?.featureModes ? Object.entries(config.featureModes) : [];

  return (
    <Screen scroll refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}>
      <SectionTitle>AI document processing</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        <Info label="Status" last={false}>
          <StatusPill
            label={config?.globallyEnabled ? 'Enabled' : 'Disabled'}
            bg={config?.globallyEnabled ? c.brandSoft : c.dangerSoft}
            fg={config?.globallyEnabled ? c.brand : c.danger}
          />
        </Info>
        <Info label="Provider" last={false}>
          <Text style={{ color: c.text, fontWeight: '600' }}>{config?.providerName ?? 'mock'}</Text>
        </Info>
        <Info label="Human review required" last={false}>
          <Text style={{ color: c.text, fontWeight: '600' }}>
            {config?.humanReviewRequired ? 'Yes' : 'No'}
          </Text>
        </Info>
        <Info label="Auto financial approval" last>
          <Text style={{ color: c.text, fontWeight: '600' }}>
            {config?.automaticFinancialApproval ? 'On' : 'Off'}
          </Text>
        </Info>
      </Card>

      {modes.length > 0 ? (
        <>
          <SectionTitle>Feature modes</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {modes.map(([key, mode], i) => (
              <Info key={key} label={key.replace(/_/g, ' ').toLowerCase()} last={i === modes.length - 1}>
                <Text style={{ color: c.muted, fontSize: 12 }}>{mode.replace(/_/g, ' ').toLowerCase()}</Text>
              </Info>
            ))}
          </Card>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <Ionicons name="information-circle-outline" size={15} color={c.subtle} />
        <Text style={{ color: c.subtle, fontSize: 12 }}>Change these settings on the web app.</Text>
      </View>
    </Screen>
  );
}

function Info({ label, children, last }: { label: string; children: ReactNode; last: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 14, flex: 1, textTransform: 'capitalize' }}>{label}</Text>
      {children}
    </View>
  );
}
