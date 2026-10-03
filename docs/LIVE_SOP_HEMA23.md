# ZenCore SOP TF2 — SOLID + HEMA23

Versi: SOLID_TF2_3GREEN_HEMA23_V2

## Entry

Semua syarat berikut perlu lulus bersama:

1. Feed timeframe 2 minit.
2. Keadaan SOLID asal Pine masih sah: setup aktif/triggered, harga lepas entry
   dan basis, WaveTrend searah, RSI BUY <75 / SELL >25, bukan re-entry.
3. Minimum tiga daripada lima checklist Pine hijau.
4. BUY: NEUTRAL >55 atau BULLISH >50. SELL: NEUTRAL <45 atau BEARISH >50.
5. HEMA TF2: BUY fast20 > slow40 dan kedua-duanya naik; SELL sebaliknya.
6. HEMA TF3: syarat sama menggunakan dua candle TF3 yang sudah tutup.

Slope dibandingkan dengan candle sebelumnya. Sama/mendatar, arah bercanggah,
TF3 belum confirmed atau data HEMA tidak lengkap => WAIT.
HEMA STRONG ialah label syarat, bukan jaminan profit atau probability.

Checklist minimum 3 ialah kiraan boolean daripada Pine, bukan tiga bukti bebas.
HTF checklist TF2 menggunakan TF5. Confirmation HEMA TF3 adalah gate tambahan.
Gred C+ lama tidak menghalang entry versi ini.

## Pelaksanaan dan exit

Lot/layer, TP1/2/3 dan SL mengikut setting/pelan sedia ada. Tiada hedging,
counter-entry, grid atau martingale ditambah dalam release ini.
Entry ditolak jika quote sudah mencapai TP1 atau SL; freshness, command TTL,
identiti akaun dan permission sedia ada dikekalkan. Scope DEMO tidak diperluas.
TP1/2/3 menggunakan StepLock dan exit Pine sedia ada, bukan TP pendek baru.
Tiada perubahan strategi exit dalam release ini.

## Telegram

Entry hanya dihantar apabila keputusan Analysis meluluskan SOP versi ini,
semua enam gates PASS, feed segar dan event tidak duplicate. Mesej menunjukkan
TF2, kiraan checklist, forecast, HEMA2/HEMA3 serta harga pelan yang sama.
Sekatan quality ≥50 lama dibuang bagi penghantaran SOP ini. Pending entry
daripada versi lama tidak dihantar. Mesej pengurusan posisi kekal tersedia.
Alert Telegram bukan pengesahan bahawa MT5 sudah membuka posisi.

## Aktifkan feed TradingView baru

Alert TradingView menyimpan salinan script/settings/timeframe ketika dicipta.
Mengubah script pada chart sahaja tidak mengemas kini alert lama.

1. Download Pine main dan multi-pair melalui halaman download ZenCore:
   /downloads/ZenCore_2M_Main.pine dan /downloads/ZenCore_2M_MultiPair.pine.
2. Dalam Pine Editor, gantikan sumber indikator berkenaan, Save dan Add to chart.
3. Gunakan chart timeframe **2 minutes**. Pastikan script compile tanpa error.
4. Kekalkan webhook URL dan secret sendiri dalam setting; jangan kongsi secret.
5. Stop/delete alert lama supaya tidak menghantar payload lama yang bercanggah.
6. Cipta alert baru untuk script yang dikemas kini: Any alert() function call;
   gunakan webhook ZenCore yang sama. Multi-pair menghantar sembilan pair.
7. Apabila market buka, semak feed TF2 diterima. HEMA TF2/TF3 mesti mempunyai
   data; hanya selepas confirmation sebenar lulus status menjadi READY.
8. Jika ada kedua-dua main dan multi alert, kedua-duanya mesti menggunakan
   script baru. Main chart mempunyai keutamaan pada snapshot candle sama.

Feed ini masih menghantar pada candle close. Ia bukan exact timestamp event
label SOLID pertama yang boleh muncul intrabar. Jangan dakwa latency sifar.

## Validation

Targeted tests meliputi forecast boundaries, checklist, HEMA, compact feed,
Telegram formatting/eligibility, freshness, scoped DEMO dan sembilan pair.
Sumber Pine telah disemak secara statik; compilation dan alert creation pada
TradingView perlu disahkan dalam editor sebenar. Backtest terdahulu ialah proxy,
bukan jaminan prestasi live. Jangan hantar signal ujian sebagai signal sebenar.
