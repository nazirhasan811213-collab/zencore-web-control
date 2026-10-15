# Draf ujian TF2 — SL 0.65 ATR + warna HEMA wajib

Status: draf sahaja. Tidak disambungkan kepada server live. Semua alert Pine dinyahaktifkan dalam kod. Connector, EA, TF15 dan polisi production tidak diubah.

## Kandungan
- ZenCore_TF2_SL065_HEMA_DRAFT.pine: salinan penuh indikator berasaskan V5.2 untuk semakan visual.
- policy.js: kalkulator pelan dan pengesahan untuk ujian offline; bukan pengganti authorization server.
- test/policy.test.js: ujian BUY/SELL, had struktur, pembundaran tick, data tidak sah dan HEMA wajib.

## Aturan
SOLID dan minimum 5/6 pengesahan kekal. BUY wajib HEMA20 > HEMA40; SELL wajib HEMA20 < HEMA40. Sama nilai atau data hilang: tiada entry. Cerun HEMA40 tetap wajib.

Definisi struktur draf yang dipilih untuk ujian: BUY menggunakan low paling rendah daripada 3 candle TF2 SEBELUM candle semasa; SELL menggunakan high paling tinggi. Ketiga-tiganya mesti sudah tutup. Ini proksi struktur tempatan, bukan pengesanan swing pivot.

Buffer ialah 1 minimum tick. Jarak SL = maksimum(0.65 × ATR14, jarak entry ke struktur + buffer). SL dibundarkan keluar mengikut tick broker/chart. Jika jarak selepas pembundaran melebihi 0.75 × ATR14, TUNGGU; jangan klip SL ke dalam struktur. Struktur mesti di sisi perlindungan yang betul.

Entry draf ialah harga ketika SOP lengkap. ATR dan SL awal dibekukan ketika itu; TP1=min(0.5 ATR, 2), TP2=1 ATR, TP3=1.5 ATR. Step-lock, partial dan emergency exit kekal. Tiada penambahan re-entry. Native chart plan asal dikekalkan untuk sumber signal; gunakan garisan `DRAFT SL 0.65–0.75 ATR` dan `SOP80 Entry (qualification)` untuk pelan ujian, bukan garisan Entry/Stoploss native.

## Cara semak chart
1. Buka chart XAUUSD 2 minit berasingan untuk ujian.
2. Pine Editor: skrip baharu, paste keseluruhan fail DRAFT, Save, Add to chart.
3. Pilih Scalping dan Fixed R:R. Jangan ganti indikator live.
4. Panel DRAFT menunjukkan minimum 5/6, HEMA wajib dan kelayakan struktur SL.
5. Tiada alert perlu dicipta: semua alert dalam draf memang disekat.

## Semakan pembangunan
Dari root repo: `node --test drafts/tf2-sl065-hema/test/policy.test.js`.
Module policy.js bergantung pada tf2-solid-80-sop.js di root repo. Ia tidak menyemak keseluruhan freshness, akaun, broker atau kebenaran execution; semua itu masih mesti diperiksa jika draf diintegrasikan kelak.

Ujian ini mengesahkan formula/aturan sahaja, bukan profit. Belum dikompil dalam TradingView sebenar, belum backtest candle sebenar, belum diuji dengan fill/spread/slippage broker. Tiada deployment production dibenarkan oleh pakej ini. Pelaksanaan live memerlukan integrasi validator risk plan server dan semakan harga fill sebenar sebelum digunakan.
