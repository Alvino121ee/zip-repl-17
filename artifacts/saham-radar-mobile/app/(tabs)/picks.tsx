import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScoreBadge } from '@/components/ScoreBadge';
import { useGetTodayPicks, useGeneratePicks } from '@workspace/api-client-react';

function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

export default function PicksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const { data, isLoading, refetch } = useGetTodayPicks();
  const picks = data?.picks ?? [];
  const summary = data?.summary;
  const today = data?.date ?? new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const profitColor = summary && summary.totalProfitAmount >= 0 ? colors.positive : colors.negative;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) }}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPad + 8 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Daily Picks AI</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Saham pilihan hari ini
        </Text>
        <View style={[styles.dateChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="calendar" size={12} color={colors.mutedForeground} />
          <Text style={[styles.dateText, { color: colors.mutedForeground }]}>{today}</Text>
        </View>
      </View>

      {/* Summary Stats */}
      {summary && (
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.summaryValue, { color: profitColor }]}>
              {summary.totalProfitAmount >= 0 ? '+' : ''}{formatRupiah(summary.totalProfitAmount)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Profit</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {summary.winRate.toFixed(0)}%
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Win Rate</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {summary.openPicks}/{summary.totalPicks}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Open Picks</Text>
          </View>
        </View>
      )}

      {/* Picks List */}
      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat picks...</Text>
        </View>
      ) : picks.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="target" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Belum ada picks hari ini
          </Text>
        </View>
      ) : (
        picks.map((pick, index) => {
          const isOpen = pick.status === 'open';
          const profit = pick.profitAmount ?? 0;
          const profitColor = profit > 0 ? colors.positive : profit < 0 ? colors.negative : colors.mutedForeground;

          return (
            <View
              key={pick.id}
              style={[styles.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.pickHeader}>
                <View style={styles.pickLeft}>
                  <Text style={[styles.rankNum, { color: colors.mutedForeground }]}>#{pick.rank}</Text>
                  <View style={[styles.tickerBadge, { backgroundColor: colors.primary + '18' }]}>
                    <Text style={[styles.ticker, { color: colors.primary }]}>{pick.ticker}</Text>
                  </View>
                  <View>
                    <Text style={[styles.pickName, { color: colors.foreground }]} numberOfLines={1}>
                      {pick.name}
                    </Text>
                    <Text style={[styles.pickSector, { color: colors.mutedForeground }]}>{pick.sector}</Text>
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: isOpen ? colors.primary + '20' : colors.mutedForeground + '20' }]}>
                  <Text style={[styles.statusText, { color: isOpen ? colors.primary : colors.mutedForeground }]}>
                    {isOpen ? 'Open' : 'Closed'}
                  </Text>
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View style={styles.pickDetails}>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Harga Masuk</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>
                    {formatRupiah(pick.entryPrice)}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Skor AI</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>
                    {pick.totalScoreAtPick.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>P&L</Text>
                  <Text style={[styles.detailValue, { color: profitColor }]}>
                    {profit >= 0 ? '+' : ''}{formatRupiah(profit)}
                  </Text>
                </View>
              </View>

              {pick.reason && (
                <Text style={[styles.reason, { color: colors.mutedForeground, borderTopColor: colors.border }]}>
                  {pick.reason}
                </Text>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  dateText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: { fontSize: 14, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  summaryLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 14,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  pickCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pickHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  pickLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  rankNum: { fontSize: 12, fontFamily: 'Inter_500Medium', width: 22 },
  tickerBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ticker: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  pickName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  pickSector: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  divider: { height: 1, marginHorizontal: 14 },
  pickDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  detailItem: { alignItems: 'center', flex: 1 },
  detailLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginBottom: 4 },
  detailValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  reason: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 16,
    padding: 14,
    borderTopWidth: 1,
  },
});
