import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { StockRow } from '@/components/StockRow';
import { ScoreBadge } from '@/components/ScoreBadge';
import { useListStocks } from '@workspace/api-client-react';

const LABEL_FILTERS = ['Semua', 'Strong Watchlist', 'Watchlist', 'Neutral', 'Risky', 'Avoid'];

export default function ScreenerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const [search, setSearch] = useState('');
  const [activeLabel, setActiveLabel] = useState('Semua');

  const { data, isLoading, refetch } = useListStocks({
    search: search || undefined,
    label: activeLabel === 'Semua' ? undefined : activeLabel,
    limit: 50,
    sortBy: 'totalScore',
    sortDir: 'desc',
  });

  const stocks = data?.stocks ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPad + 8, backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Screener</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {data?.total ?? 0} saham IDX
        </Text>

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Cari kode atau nama..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="characters"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Label Filter */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={LABEL_FILTERS}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterChip,
                {
                  backgroundColor: activeLabel === item ? colors.primary : colors.card,
                  borderColor: activeLabel === item ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setActiveLabel(item)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: activeLabel === item ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat data...</Text>
        </View>
      ) : (
        <FlatList
          data={stocks}
          keyExtractor={(item) => item.ticker}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Feather name="bar-chart-2" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Tidak ada saham ditemukan
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <StockRow
              ticker={item.ticker}
              name={item.name}
              price={item.currentPrice}
              changePercent={item.priceChangePct}
              score={item.totalScore}
              rank={index + 1}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  filterList: {
    gap: 6,
    paddingBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  listContent: {},
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
