# ZenCore strategi kedua: TF10, dua layer

Versi: SOLID_TF10_3GREEN_HEMA23_2L_V1.

Status: modul keputusan dan pengurusan posisi offline siap, dengan unit tests. Belum disambungkan kepada dispatcher, API, Pine feed TF10, Telegram atau EA live. Tiada P/L/backtest TF10 atau forward profit dilaporkan. Strategi TF2 production tidak berubah.

## Tafsiran arahan

“Follow all, entry TF10 dan hanya dua layer” ditafsirkan sebagai formula SOLID/checklist/forecast sama pada chart TF10, serta confirmation HEMA TF2 dan TF3 yang disebut sebelum ini dikekalkan. Tiada confirmation TF15/TF30 ditambah. Ia strategi tambahan, bukan menggantikan TF2.

Forecast 10 candle pada TF10 mempunyai horizon kira-kira 100 minit, berbanding 20 minit pada TF2. Ini bukan ramalan harga yang pasti atau jaminan trade akan mengambil tempoh tersebut. Entry TF10 tidak boleh dianggap scalping kelajuan sama seperti TF2.

## Trigger

1. Chart/feed sebenar TF10, candle confirmed; sumber open/close berselang 600000ms. Jangan tukar label timeframe payload TF2 menjadi 10.
2. SOLID asal Pine pada TF10: setup active dan triggered, harga melepasi entry dan basis, WT searah, bukan WT cross bertentangan, RSI BUY<75 / SELL>25. Keadaan asal Pine perlu direkod tepat; modul tidak menjana indikator daripada screenshot.
3. Minimum 3 daripada 5 booleans checklist chart hijau. Formula lima elemen kekal: WT, close berbanding basis, HEMA chart TF10, warna candle, serta ribbon TF5 sebagai elemen MTF asal. TF5 kini lebih kecil daripada entry TF10; jangan namakan ia higher timeframe bagi strategi ini.
4. Forecast BUY: NEUTRAL>55 atau BULLISH>50; SELL: NEUTRAL<45 atau BEARISH>50.
5. HEMA TF2: fast20/slow40 aligned dan kedua-dua slope searah trade.
6. HEMA TF3: sama, tetapi nilai daripada candle TF3 yang sudah tutup dan candle sebelumnya.

HEMA TF2/TF3 mesti datang daripada konteks indikator masing-masing. HEMA chart TF10 tidak boleh dihantar sebagai TF2. Pada chart TF10, kedua-duanya lower timeframe: feed Pine perlu menggunakan akses lower-TF yang sesuai dan nilai terakhir yang lengkap pada masa keputusan, dengan pemeriksaan timestamp. Feed TF2 live sekarang tidak menyokong strategi kedua ini secara automatik.

## Entry dan saiz posisi

- DEMO sahaja; akaun/sambungan disahkan oleh adapter sebelum execution. Modul tidak menerima atau mengeluarkan password.
- Command sasaran tepat dua layer. Input layers selain 2 ditolak. Default lotPerLayer=0.01; jumlah default=0.02.
- Satu basket per pair. Tiada hedge, martingale atau tambahan layer.
- Feed tidak lebih 30s selepas TF10 close; quote broker tidak lebih 5s. Command TTL 15s. Angka ini aturan kandidat, bukan ukuran latency yang sudah dibuktikan.
- TP/SL datang daripada pelan TF10 sendiri: sourceTimeframe=10. Kekalkan formula/range setting Pine pada timeframe baharu; tidak menyalin harga atau ATR pelan TF2. Modul menolak pelan asal TF2.
- Quote belum sampai TP1 atau SL. SL mematuhi minimum distance broker.
- Net TP1 reward/risk >=0.5 dan kos/baki target kasar <=20%.
- Sasaran max risiko setup 0.5% equity; max risiko keseluruhan 1.5% equity.
- Daily net P/L <=−2% equity awal hari: pause entry baharu, terus urus posisi sedia ada.
- Minimum/maximum/step volume, tick size/value, komisen dan slippage reserves perlu diketahui. Unknown menghasilkan WAIT_DATA, bukan anggaran sifar.
- Broker mesti meluluskan margin untuk total lot yang sama. SL tidak dilebarkan untuk muatkan lot; jika dua layer minimum melanggar risiko, SKIP.

Had risiko ialah cadangan mod terkawal baharu untuk strategi kedua; bukan perubahan pada polisi amaran sahaja yang sedang live. Default minimum 0.02 lot boleh melebihi bajet USD100. Tiada jaminan strategi akan mempunyai trade dengan modal/lot tersebut.

Spread masuk melalui Bid/Ask executable fill; ia digunakan sebagai komponen diagnostik kos tetapi tidak ditolak dua kali daripada net reward. Kiraan sebelum fill menganggarkan slippage adverse; adapter perlu mengira semula selepas actual fill.

## Execution yang diperlukan sebelum boleh live

Adapter belum dibina/diaktifkan untuk modul ini. Ia mesti:

1. Menggunakan strategy/version dan setup ID berasingan daripada TF2.
2. Semak quote, lease, DEMO, owner account dan broker permission sebelum setiap order.
3. Buka dua order sahaja, simpan tiket sebenar dan reconcile partial fills. Broker tidak menjamin dua order atomik; jika hanya satu berjaya, laporkan partial execution dan selesaikan menurut polisi yang ditetapkan, jangan retry sehingga menjadi tiga layer.
4. Pasang SL pada broker. Tidak menukar broker TP kepada TP3 full-close jika strategi menggunakan StepLock TP3.
5. Acknowledge tindakan hanya selepas broker mengesahkan berjaya; reconnect tidak boleh menggandakan entry/partial.
6. Kekalkan scope DEMO akaun pengguna yang diluluskan; admin/IB hanya melihat status yang dibenarkan.

## Pengurusan posisi

| Event | Tindakan |
|---|---|
| TP1 | SL setiap tiket ke actual fill tiket tersebut |
| TP2 | SL baki ke TP1 |
| TP3 | SL baki ke TP2 |
| Close Separuh Pine confirmed | Tutup 50%; dengan dua layer sama volume, bersamaan satu layer |
| Exit remaining / emergency / SL | Tutup baki/all mengikut event |

Tiada TP1 full-close automatik ditambah. State lock/partial dikemaskini hanya selepas acknowledgement berjaya. MOVE_SL_ENTRY actual stop perlu reconcile daripada posisi broker, bukan menggunakan plan.entry. Stop tidak dilonggarkan. Adapter perlu hormati stop/freeze levels broker dan mengurus failed modification; pure module menyediakan intent sahaja.

## Fail dan ujian

- strategies/tf10-two-layer.js: konfigurasi, keputusan entry, StepLock/partial intents, acknowledgement.
- normal-entry-sop.js: shared evaluator, wrapper TF2 asal dikekalkan.
- test/tf10-two-layer.test.js: BUY/SELL, timeframe, 2-layer enforcement, stale data, risiko, margin, costs, StepLock, partial, protected SL dan plan provenance.

Targeted suite: 24 tests lulus termasuk 10 TF10 tests, regresi TF2, compact HEMA dan timestamp audit. Ini validation logik, bukan bukti strategi untung.

Sebelum deploy: bina feed TF10 sebenar, adapter execution/Telegram/dashboard strategy selection, compile Pine/EA dalam platform sebenar, replay broker ticks yang sepadan, kemudian forward DEMO pada tempoh baharu. Tiada deployment diminta atau dilakukan dalam binaan ini.
