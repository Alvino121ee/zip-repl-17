import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface StockRowProps {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
  score?: number;
  rank?: number;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `Rp ${price.toLocaleString('id-ID')}`;
  }
  return `Rp ${price}`;
}

export function StockRow({ ticker, name, price, changePercent, score, rank }: StockRowProps) {
  const colors = useColors();
  const isPositive = changePercent > 0;
  const isNegative = changePercent < 0;
  const changeColor = isPositive ? colors.positive : isNegative ? colors.negative : colors.mutedForeground;

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.left}>
        {rank != null && (
          <Text style={[styles.rank, { color: colors.mutedForeground }]}>{rank}</Text>
        )}
        <View style={[styles.tickerBadge, { backgroundColor: colors.primary + '18' }]}>
          <Text style={[styles.ticker, { color: colors.primary }]}>{ticker}</Text>
        </View>
        <View style={styles.nameBlock}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          {score != null && (
            <Text style={[styles.score, { color: colors.mutedForeground }]}>
              Skor {score.toFixed(1)}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.price, { color: colors.foreground }]}>{formatPrice(price)}</Text>
        <Text style={[styles.change, { color: changeColor }]}>
          {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  rank: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    width: 18,
    textAlign: 'center',
  },
  tickerBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  ticker: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  nameBlock: {
    flex: 1,
  },
  name: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  score: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  right: {
    alignItems: 'flex-end',
    gap: 2,
  },
  price: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  change: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
