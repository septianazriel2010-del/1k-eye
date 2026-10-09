/** Explain mapped-site availability without claiming an unobserved overload. */
export function installationFeedback(stats = {}, now = Date.now()) {
  const reasons = {
    rate_limited: 'Overpass membatasi permintaan',
    timeout: 'Waktu permintaan Overpass habis',
    query_failed: 'Overpass tidak dapat menyelesaikan kueri',
    tiles_unavailable: 'Ubin peta untuk sementara tidak tersedia',
    names_unavailable: 'Nama lokasi untuk sementara tidak tersedia',
  };
  const reason =
    reasons[stats.failureReason] || 'Overpass untuk sementara tidak tersedia';
  if (stats.loading)
    return stats.retrying
      ? 'Mencoba ulang pemetaan lokasi…'
      : 'Memuat lokasi terpetakan…';
  if (stats.retryAt > 0) {
    const seconds = Math.max(0, Math.ceil((stats.retryAt - now) / 1000));
    return `${reason} — ${seconds ? `coba lagi dalam ${seconds} dtk` : 'menunggu percobaan ulang'}`;
  }
  if (stats.status === 'unavailable') return reason;
  if (stats.status === 'zoom-in')
    return 'Perbesar untuk mencari instalasi terpetakan';
  if (stats.stale) return 'Menampilkan lokasi tersimpan';
  if (stats.status === 'idle') return 'Lokasi terpetakan belum dimuat';
  // With a count, say what was found and where; an empty area is not "loaded".
  if (Number.isFinite(stats.count)) {
    const km =
      stats.coverage?.kind === 'subject' &&
      Number.isFinite(stats.coverage.radiusM)
        ? Math.round(stats.coverage.radiusM / 1000)
        : null;
    const where = km ? ` dalam radius ${km} km dari kontak` : ' dalam tampilan';
    if (stats.count === 0) return `Tidak ada lokasi terpetakan${where}`;
    return `${stats.count} lokasi terpetakan${where}`;
  }
  return 'Lokasi terpetakan dimuat';
}
