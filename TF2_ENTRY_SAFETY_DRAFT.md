# ZenCore TF2 — ATR + pertukaran arah sahaja (DRAF V2)

Belum live. Versi ini menggantikan semua penapis tambahan dalam draf sebelumnya.

## Dua pencetus sahaja

1. **ATR8 >4.50 DAN minimum 2 pertukaran arah dalam 6 candle TF2 tertutup.**
2. **ATR8 <1.50 DAN minimum 2 pertukaran arah dalam 6 candle TF2 tertutup.**

Paras 1.50 dan 4.50 tepat termasuk julat biasa; tidak mencetuskan. “ATR 1.5” ditafsirkan sebagai bawah 1.5 mengikut perbincangan asal. Arah daripada close berbanding open sebenar; doji tidak menambah pertukaran arah. Semua penilaian selepas candle tutup.

BUY/SELL dan re-entry disekat hanya apabila salah satu gabungan dipenuhi. ATR luar julat sahaja atau pertukaran arah sahaja tidak menyekat.

## Pelepasan

Setiap candle tertutup dinilai semula. Jika ATR kembali 1.50–4.50 ATAU bilangan pertukaran arah dalam enam candle terkini kurang 2, sekatan dilepaskan. Tiada zon beku, breakout atau candle pengesahan di luar zon. Tiada syarat USD6, pullback 40%, atau pencetus 3 pertukaran arah berasingan.

Pelepasan membenarkan semakan SOP entry asal dan signal baharu yang sah, bukan automatik membuka order atau menghidupkan event lama. SOP asal, SL/TP, exit, tetapan pengguna dan TF15 kekal. Enam candle dan ATR sah diperlukan untuk memanaskan penapis.

## Signal chart / Telegram

- ⛔ TF2 — SEKAT ENTRY: ATR8, bilangan pertukaran arah dan sebab ATR tinggi/rendah.
- ✅ TF2 — SEKATAN DILEPASKAN: syarat tidak lagi dipenuhi; ikut SOP asal.

Signal pada perubahan status sahaja; retry sama didedup menggunakan versi + masa candle + jenis signal. Hanya Execution confirmed, data segar maksimum 60 saat dan penerima Telegram sedia ada yang layak. Tiada mesej ujian dihantar.

## Fail dan status

Pine `ZenCore_TF2_ATR8_TP1Max3.pine` draf V3.4; metadata `TF2_ATR_REVERSALS_V2`. `tf2-entry-safety.js` menyediakan replay logik, validator dan mesej. Server strategy, entry contract, queued delivery dan Telegram memeriksa bukti yang sama. Feed lama tanpa metadata kekal serasi dan tidak mempunyai penapis ini.

Ujian logik bukan bukti win rate atau jaminan mengelakkan libas. Pine belum compile/replay di TradingView; perlu pengesahan sebelum live. Server dan Pine baharu mesti digunakan bersama. EA dan Connector tidak diubah.
