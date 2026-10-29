# ZenCore TF2 — sekatan libas dan pergerakan besar (DRAF)

Versi ujian 3.4, belum merge/deploy dan belum dipasang pada TradingView.
TF15, EA, Connector dan tetapan akaun tidak diubah.

## Peraturan

- Semua penilaian selepas candle TF2 tutup. Enam candle pertama ialah pemanasan.
- Libas: sekurang-kurangnya 3 perubahan arah badan candle dalam 6 candle tertutup. Arah menggunakan close berbanding open sebenar; doji diabaikan dalam kiraan perubahan arah.
- Tambahan ATR tinggi: ATR8 **>4.50** pada candle tertutup + sekurang-kurangnya **2** perubahan arah dalam 6 candle turut mencetuskan zon yang sama. ATR tinggi sahaja tidak menyekat. Tepat 4.50 menggunakan peraturan biasa 3 perubahan. Ini parameter awal, belum ditentukur melalui backtest. Bacaan ATR turun semula tidak membuka sekatan; breakout dan candle pengesahan masih wajib. Chart dan Telegram memaparkan sebab ATR tinggi, ATR pencetus serta bilangan perubahan arah.
- Bekukan zon daripada high tertinggi dan low terendah enam candle pencetus. Jangan gerakkan zon semasa menunggu pengesahan.
- Sekat kedua-dua BUY/SELL, termasuk re-entry. Dua candle searah dalam zon tidak melepaskan sekatan.
- Satu close di luar zon memulakan pengesahan. Candle berikutnya mesti seluruhnya di luar zon pada arah sama, termasuk wick. Sentuhan sempadan juga gagal.
- Jika gagal, kekalkan zon dan tunggu percubaan breakout baharu. Candle yang gagal tidak terus dianggap breakout pengganti.
- Selepas pelepasan, kumpul enam candle bermula dengan candle pengesahan sebelum menguji pencetus libas baharu; jangan guna semula candle libas lama.
- Pergerakan besar: lebih daripada 6.00 unit harga XAUUSD, bukan kerugian akaun atau USD bagi lot tertentu. Tepat 6.00 tidak mencetuskan.
- Leg BUY bermula pada open candle bullish pertama; jejak high tertinggi sepanjang candle bullish berturut-turut. SELL simetri. Sebelum ambang, candle badan bertentangan menamatkan leg kecil. Selepas ambang, leg dikekalkan merentasi pullback.
- Jejak BUY dan SELL secara berasingan supaya reversal besar turut disekat. Sekatan besar BUY tidak membenarkan SELL secara automatik; SELL masih memerlukan SOP sendiri dan bebas sekatan SELL/libas.
- Selepas ambang, tunggu candle kemudian tutup pada retracement sekurang-kurangnya 40% daripada leg. Candle pencetus >6 tidak boleh terus mengesahkan pullback sendiri.
- Kemudian tunggu candle berasingan searah: BUY close melepasi high candle sebelumnya; SELL close di bawah low sebelumnya. Jika extreme baharu terbentuk sebelum pelepasan, pengesahan pullback ditetapkan semula.
- Kedua-dua sekatan mesti lulus untuk arah yang hendak didagangkan. Pelepasan hanya membuka semakan SOP; bukan arahan membuka order. Event entry lama tidak diperbaharui atau dipanjangkan.
- SL, TP, native exit dan pengurusan posisi terbuka terus berjalan. Penapis ini tidak menutup posisi dengan sendirinya.

## Signal chart dan Telegram

Tujuh keadaan: sekat libas, breakout menunggu pengesahan, breakout gagal, pengesahan zon lulus, sekat kejar >6, pullback 40% dicapai, dan pullback + momentum disahkan.

Telegram menggunakan saluran Execution, candle confirmed, data segar <=60 saat, dan notification key versi + masa candle + jenis kejadian. Retry kejadian yang sama tidak menghasilkan mesej kedua. Tetapan penerima dan tempoh akses sedia ada dikekalkan. Tiada mesej ujian dihantar.

Contoh (harga ilustrasi):

> ⛔ SEKAT ENTRY — MARKET LIBAS
> XAUUSD · TF2 · Candle sudah tutup
> Zon libas: 4021.00 – 4025.00
> BUY / SELL disekat. Tunggu breakout dan satu candle penuh di luar zon.
> Panduan ZenCore — Jangan entry ketika harga masih berulang-alik.

> ⛔ BREAKOUT GAGAL — SEKATAN KEKAL
> XAUUSD · TF2 · Candle sudah tutup
> Zon libas: 4021.00 – 4025.00
> BUY / SELL disekat. Tunggu breakout dan satu candle penuh di luar zon.
> Panduan ZenCore — Jangan entry ketika harga masih berulang-alik.

> ⚠️ PERGERAKAN LEBIH USD6 — JANGAN KEJAR
> XAUUSD · TF2 · Candle sudah tutup
> Sekat kejar BUY. Tunggu pullback 40% dan momentum kembali.
> Panduan ZenCore — Jangan kejar harga. Ini bukan signal entry.

> ✅ PULLBACK DAN MOMENTUM DISAHKAN
> XAUUSD · TF2 · Candle sudah tutup
> Panduan ZenCore — Sekatan ini selesai. Entry masih perlu signal baharu dan SOP lengkap.

## Integrasi

- Pine: `ZenCore_TF2_ATR8_TP1Max3.pine` draf V3.4, plot zon dan label Melayu, metadata `setupMeta.entrySafety`, gate initial/re-entry/ready.
- Server: `tf2-ribbon-scalping.js` menyemak bukti sekatan pada strategy dan entry contract, termasuk jika READY dipaksa.
- Signal: `tf2-entry-safety.js` mengandungi mesin replay, validator, pembina mesej dan semakan freshness.
- Telegram: `analysis-alert-service.js` menggunakan stor notification/delivery sedia ada untuk mesej panduan sekatan, tanpa menjadikannya signal entry atau close.
- Feed lama tanpa metadata kekal serasi. Oleh itu memasang server sahaja tidak mengaktifkan perlindungan untuk Pine lama.

## Pengesahan dan had

Ujian automatik meliputi gagal breakout, wick masuk semula, doji, multi-candle >6 dua arah, reversal besar, pullback/momentum, data intrabar/berulang/lama, gate kontrak entry, kesinambungan exit dan dedup signal.

Ini ujian logik, bukan bukti prestasi atau win rate. Pine belum disahkan oleh compiler TradingView dan replay chart sebenar belum dibuat. Screenshot tidak mencukupi untuk backtest tepat. Penapis selepas candle tutup tidak boleh mengelakkan pergerakan pertama yang berlaku sebelum candle tutup atau menjamin breakout seterusnya berjaya.

Sebelum live: compile Pine V3.4 di TradingView, replay OHLC sejarah secara berurutan, semak data split Dashboard/Execution dan demo, kemudian deploy server serta cipta semula kedua-dua alert menggunakan Pine baharu. Jangan gunakan Pine ini dengan server lama kerana server lama tidak menyemak metadata sekatan.
