> Digantikan oleh [SOP Dual TF ATR40](DUAL-TF-ATR40-20261006.md), yang merangkumi TF2 dan TF15.

# TF2 — SOLID setup dipegang, pengesahan semasa

Status: kod calon sahaja; belum deploy ke produksi. Pine belum dikompilasi/diaktifkan di TradingView.
Versi SOP: NORMAL_20261001_TF2_SEQ_V3. Polisi feed: TF2_SEQUENTIAL_V1.

1. SOLID BUY/SELL mengaktifkan setup dengan identiti dan paras Entry/SL/TP yang sama.
2. SOLID tidak perlu kekal muncul pada candle pengesahan seterusnya.
3. Syarat 2–6 menggunakan data semasa: harga melepasi entry, checklist >=4/5, forecast searah, HEMA TF2 dan TF3 searah.
4. BUY dibenarkan apabila Entry < harga < TP1. SELL apabila TP1 < harga < Entry.
5. Jika harga melepasi TP1, setup menunggu pullback. Entry memerlukan semua pengesahan semasa kembali lulus.
6. Setup tamat/SL/exit penuh membatalkan latch. Arah atau identiti/paras setup baharu tidak mewarisi SOLID lama.
7. Pengesahan lama yang sudah bertukar arah tidak dikumpul sebagai PASS kekal.
8. Feed baharu membawa masa semasa; usia SOLID asal tidak digunakan sebagai usia penghantaran order.
9. Jika WAIT baharu tiba semasa dispatch sibuk, ia menggantikan readiness TF2 lama yang masih menunggu dispatch.
10. TF15 kekal dengan SOP sedia ada. Saiz lot/layer, gred minimum C+, waktu trade dan perlindungan duplicate kekal.

Contoh: candle A SOLID BUY tetapi forecast belum lulus; candle B SOLID hilang, forecast/HEMA/checklist lulus dan harga dalam julat → layak entry. Jika harga di atas TP1 → tunggu pullback sebelum entry.

## Pengaktifan selepas semakan

Deploy keseluruhan fail server/analysis dalam pakej bersama. Gantikan script Feed TF2 dengan ZenCore_TF2_Realtime_Feed.pine dan bina semula alert TradingView menggunakan destinasi webhook sedia ada. Alert lama menggunakan salinan script lama. Compile Pine dan semak status feed sebelum ujian DEMO.

Sahkan: SOLID awal mengekalkan setup; WAIT pada pengesahan semasa tidak membuka order; pullback dalam julat dengan pengesahan lulus menghasilkan satu arahan sahaja; TF15 tidak berubah.

## Batas pengesahan

47 ujian Node lulus bagi latch, pullback, pembatalan, dispatch, kontrak, Telegram, TF isolation dan guards berkaitan. Ini bukan backtest keuntungan atau bukti order live berjaya.

Ralat EA terdahulu ENTRY_REJECTED_OR_PARTIAL masih memerlukan diagnosis execution. Pakej ini tidak membetulkan atau menggantikan EA/installer dan tidak mengubah SL broker.
