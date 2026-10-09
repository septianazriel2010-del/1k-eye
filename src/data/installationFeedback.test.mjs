import test from 'node:test';
import assert from 'node:assert/strict';
import { installationFeedback } from './installationFeedback.js';

test('retry copy follows the real deadline and does not promise an overdue timer fired', () => {
  assert.equal(installationFeedback({ retryAt: 31000 }, 1000), 'Overpass untuk sementara tidak tersedia — coba lagi dalam 30 dtk');
  assert.match(installationFeedback({ retryAt: 31000 }, 32000), /menunggu percobaan ulang$/);
  assert.match(installationFeedback({ retryAt: 241000 }, 1000), /240 dtk$/);
});
test('only known failure reasons get specific attribution', () => {
  for (const [failureReason, text] of [['rate_limited', 'membatasi permintaan'], ['timeout', 'Waktu permintaan'], ['query_failed', 'tidak dapat menyelesaikan']]) {
    assert.ok(installationFeedback({ status: 'unavailable', failureReason }).includes(text));
  }
  assert.match(installationFeedback({ status: 'unavailable', failureReason: 'unknown' }), /untuk sementara tidak tersedia/);
});
test('first fetch, retry, cached data and success have distinct copy', () => {
  assert.equal(installationFeedback({ loading: true }), 'Memuat lokasi terpetakan…');
  assert.equal(installationFeedback({ loading: true, retrying: true }), 'Mencoba ulang pemetaan lokasi…');
  assert.equal(installationFeedback({ status: 'ready' }), 'Lokasi terpetakan dimuat');
  assert.equal(installationFeedback({ stale: true }), 'Menampilkan lokasi tersimpan');
});
test('a counted result names what was found and where', () => {
  assert.equal(installationFeedback({ status: 'ready', count: 3 }), '3 lokasi terpetakan dalam tampilan');
  assert.equal(installationFeedback({ status: 'empty', count: 0 }), 'Tidak ada lokasi terpetakan dalam tampilan');
  const coverage = { kind: 'subject', radiusM: 100_000 };
  assert.equal(
    installationFeedback({ status: 'ready', count: 1, coverage }),
    '1 lokasi terpetakan dalam radius 100 km dari kontak',
  );
  assert.equal(
    installationFeedback({ status: 'unavailable', failureReason: 'tiles_unavailable' }),
    'Ubin peta untuk sementara tidak tersedia',
  );
});
