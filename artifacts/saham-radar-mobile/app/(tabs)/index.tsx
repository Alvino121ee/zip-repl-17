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
import { useColors } from '@/hooks/useColors';
import { StatCard } from '@/components/StatCard';
import { StockRow } from '@/components/StockRow';
import { useGetMarketSummary, useGetTopMovers } from '@workspace/api-client-react';

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useGetMarketSummary();

  const {
    data: movers,
    isLoading: moversLoading,
    refetch: refetchMovers,
  } = useGetTopMovers();

  const isLoading = summaryLoading || moversLoading;

  const onRefresh = () => {
    refetchSummary();
    refetchMovers();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPad + 8, backgroundColor: colors.background }]}>
        <Text style={[styles.logo, { color: colors.primary }]}>SahamRadar</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Pasar BEI Hari Ini
        </Text>
      </View>

      {/* Stats Row */}
      {summaryLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : summary ? (
        <>
          <View style={styles.statsRow}>
            <StatCard label="Total Saham" value={summary.totalStocks} />
            <StatCard label="Naik" value={summary.advancers} valueColor={colors.positive} />
            <StatCard label="Turun" value={summary.decliners} valueColor={colors.negative} />
            <StatCard label="Netral" value={summary.unchanged} valueColor={colors.mutedForeground} />
          </View>

          {/* Sentiment */}
          {summary.marketSentiment && (
            <View style={[styles.sentimentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sentimentLabel, { color: colors.mutedForeground }]}>Sentimen Pasar</Text>
              <Text style={[styles.sentimentValue, { color: colors.primary }]}>
                {summary.marketSentiment}
              </Text>
            </View>
          )}
        </>
      ) : null}

      {/* Top Gainers */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.positive }]}>▲ Top Gainers</Text>
        </View>
        {moversLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          movers?.gainers?.slice(0, 5).map((s) => (
            <StockRow
              key={s.ticker}
              ticker={s.ticker}
              name={s.name}
              price={s.currentPrice}
              changePercent={s.priceChangePct}
            />
          ))
        )}
      </View>

      {/* Top Losers */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.negative }]}>▼ Top Losers</Text>
        </View>
        {moversLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          movers?.losers?.slice(0, 5).map((s) => (
            <StockRow
              key={s.ticker}
              ticker={s.ticker}
              name={s.name}
              price={s.currentPrice}
              changePercent={s.priceChangePct}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  logo: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  sentimentCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sentimentLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  sentimentValue: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  loader: { padding: 20 },
});
