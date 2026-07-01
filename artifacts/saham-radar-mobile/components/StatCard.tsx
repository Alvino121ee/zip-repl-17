import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface StatCardProps {
  label: string;
  value: string | number;
  valueColor?: string;
}

export function StatCard({ label, value, valueColor }: StatCardProps) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.value, { color: valueColor ?? colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
