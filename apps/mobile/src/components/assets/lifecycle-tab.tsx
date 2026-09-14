import { Text, View } from 'react-native';
import { deviceLifecycle, type DetailAssignment, type DetailConditionLog, type LifecycleEvent } from '@techpioasset/domain';
import { useTheme } from '../../theme';
import { Card, SectionTitle } from '../ui';
import { InfoRow, useToneColor } from './detail-parts';

/**
 * Device lifecycle on the phone (web: the asset page's Lifecycle tab). The
 * chips, events, their order and every word come from `deviceLifecycle` in the
 * domain package, the function the web tab renders.
 *
 * The web's QR label card is not here: the page draws the code locally with a
 * library this app does not ship, and the API serves no image of it. Printing
 * a label is a desk job anyway - the phone's side of the QR is scanning it.
 */
export function LifecycleTab({
  data,
  formatDate,
}: {
  data: {
    purchaseDate: string | null;
    warrantyStartDate?: string | null;
    warrantyEndDate: string | null;
    expectedReplacementDate?: string | null;
    assignmentCount?: number;
    assignments: DetailAssignment[];
    conditionLogs: DetailConditionLog[];
  };
  formatDate: (iso: string | null) => string;
}) {
  const { c, spacing } = useTheme();
  const { chips, events, timesAssigned } = deviceLifecycle(data, formatDate);

  return (
    <>
      <SectionTitle>Device lifecycle</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.sm }}>
        {chips.map((chip, i) => (
          <InfoRow key={chip.label} label={chip.label} value={chip.value} last={i === chips.length - 1} />
        ))}
      </Card>
      <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.xl }}>
        This device has been assigned {timesAssigned} time{timesAssigned === 1 ? '' : 's'}. Previous holders are not
        shown.
      </Text>

      <SectionTitle>Timeline</SectionTitle>
      <Card>
        {events.length === 0 ? (
          <Text style={{ color: c.muted, fontSize: 14 }}>Nothing recorded for this device yet.</Text>
        ) : (
          events.map((e, i) => (
            <TimelineEvent key={i} event={e} formatDate={formatDate} last={i === events.length - 1} />
          ))
        )}
      </Card>
    </>
  );
}

function TimelineEvent({
  event,
  formatDate,
  last,
}: {
  event: LifecycleEvent;
  formatDate: (iso: string | null) => string;
  last: boolean;
}) {
  const { c } = useTheme();
  const dot = useToneColor(event.tone);
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginBottom: last ? 0 : 14 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot, marginTop: 5 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
          {event.title}
          {event.detail ? <Text style={{ color: c.muted, fontWeight: '400' }}> — {event.detail}</Text> : null}
        </Text>
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
          {event.date ? formatDate(event.date.toISOString()) : '—'}
        </Text>
      </View>
    </View>
  );
}
