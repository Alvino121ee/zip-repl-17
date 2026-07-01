import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface ScoreBadgeProps {
  label: string;
}

function getLabelStyle(label: string, colors: ReturnType<typeof useColors>) {
  switch (label) {
    case 'Strong Watchlist':
      return { bg: colors.primary + '22', text: colors.primary, border: colors.primary + '44' };
    case 'Watchlist':
      return { bg: '#3b82f622', text: '#60a5fa', border: '#3b82f644' };
    case 'Neutral':
      return { bg: colors.mutedForeground + '22', text: colors.mutedForeground, border: colors.mutedForeground + '44' };
    case 'Risky':
      return { bg: '#f59e0b22', text: '#fbbf24', border: '#f59e0b44' };
    case 'Avoid':
      return { bg: colors.negative + '22', text: colors.negative, border: colors.negative + '44' };
    default:
      return { bg: colors.accent, text: colors.mutedForeground, border: colors.border };
  }
}

export function ScoreBadge({ label }: ScoreBadgeProps) {
  const colors = useColors();
  const style = getLabelStyle(label, colors);

  return (
    <View style={[styles.badge, { backgroundColor: style.bg, borderColor: style.border }]}>
      <Text style={[styles.text, { color: style.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
});
