export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatLargeNumber(value: number): string {
  if (value >= 1e12) {
    return (value / 1e12).toFixed(2) + ' T';
  }
  if (value >= 1e9) {
    return (value / 1e9).toFixed(2) + ' M';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(2) + ' Jt';
  }
  return value.toLocaleString('id-ID');
}

export function formatPercent(value: number): string {
  return value.toFixed(2) + '%';
}

export function getLabelColor(label: string): string {
  switch (label) {
    case 'Strong Watchlist': return 'bg-emerald-600 text-white';
    case 'Watchlist': return 'bg-emerald-400 text-emerald-950';
    case 'Neutral': return 'bg-amber-500 text-amber-950';
    case 'Risky': return 'bg-orange-500 text-white';
    case 'Avoid': return 'bg-red-600 text-white';
    default: return 'bg-slate-500 text-white';
  }
}
