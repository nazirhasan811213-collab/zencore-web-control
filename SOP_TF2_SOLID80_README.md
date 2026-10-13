# ZenCore TF2 — SOLID dahulu, SOP 80%

14 Oktober 2026 Malaysia. Release backend SOP80. Pine masih candidate dan belum disahkan melalui Pine Editor/replay. Auto entry kekal PAUSED. Connector/EA dan SOP TF15 tidak diubah.

## Entry

SOLID Pine asal ialah pencetus wajib. PRIMARY cross SMA20 dan re-entry tidak membuka order. Pada kemunculan pertama SOLID bagi setup tersebut, semak enam pengesahan:

1. Harga melepasi entry asal: BUY di atas, SELL di bawah.
2. Momentum WT: BUY WT1 > WT2; SELL WT1 < WT2.
3. HEMA20 dan HEMA40 condong searah minimum 0.05 × ATR14 TF2 daripada HEMA candle semasa (live) berbanding candle sebelumnya. Tidak menunggu candle semasa tutup atau dua candle berlalu.
4. Checklist minimum 3/5 hijau.
5. Forecast BUY: NEUTRAL >45 atau BULLISH >45. SELL: NEUTRAL <45 atau BEARISH >45. Tepat 45, CHOPPY dan arah lain gagal pengesahan ini.
6. MTF score BUY +1 hingga +5; SELL −1 hingga −5. Skor native tiga TF15/30/60 lazimnya ±1/±3; tiada skor ±5 yang direka.

Minimum 5/6 = 83.33% lulus. 4/6 = 66.67% gagal. SOLID tidak dimasukkan dalam denominator. HEMA40 searah dan melepasi minimum cerun ialah syarat wajib: walaupun 5/6, HEMA40 mendatar atau melawan arah membatalkan entry. HEMA20 sahaja boleh menjadi satu syarat gagal jika HEMA40 lulus.

Tiada syarat wajib HEMA20 di atas/bawah HEMA40 atau minimum jarak ribbon 0.10 ATR. Warna ribbon kekal dalam checklist asal sebagai kiraan sahaja. Checklist nombor 5 menggunakan MTF. Tiada gate TF3, TF5, re-entry atau window tunggu 3 candle.

80% membenarkan satu pengesahan gagal, termasuk forecast atau MTF, apabila lima yang lain dan HEMA40 lulus. Ini kelengkapan SOP, bukan 80% kebarangkalian menang. Data angka wajib yang hilang tidak dianggap lulus. Gred quality lama tidak menjadi sekatan tambahan bagi policy baharu.

Jika gagal pada SOLID pertama, skip setup itu dan tunggu SOLID baharu. Ia tidak menjadi layak selepas syarat berubah pada candle kemudian. Freshness 30 saat ialah tempoh penghantaran/anti-replay, bukan masa menunggu SOP. Budget alert TradingView boleh menangguhkan atau menggugurkan peluang; tiada jaminan zero-latency.

## Plan, Telegram dan paparan

Apabila lulus, entry rujukan ialah harga feed ketika pengesahan. SL = 1 ATR; TP1/2/3 = 1/2/3 ATR daripada harga tersebut. Plan dibekukan. Fill MT5 sebenar boleh berbeza kerana bid/ask, spread dan slippage. StepLock TP1 menggunakan harga fill sebenar. Polisi partial/emergency dan Manual Auto Exit tidak diubah.

Telegram hanya bagi event SOP lengkap, sekali bagi setup. Mesej mengandungi bilangan lulus, peratus, HEMA40, MTF, entry/SL/TP dan nota bahawa 80% bukan win rate. Analysis dan Copilot menggunakan policy yang sama, tanpa meminta semua 6/6, TF3 atau hubungan ribbon secara tersembunyi. Telegram turut membawa snapshot Analysis, AI Coach, tips, trend, momentum, rumusan AI dan nasihat. Data ini konteks yang sama dengan keputusan entry; ia tidak menambah gate tersembunyi.

## Fail

- ZenCore_TF2_SOLID_80PCT_Draft.pine: full indicator + dashboard + bridge 67 medan. Web feed default OFF. Marker TF2_SOLID_80PCT_LIVE_V2.
- tf2-solid-80-sop.js: evaluator dan strategy server. Versi NORMAL_20261001_TF2_SOLID_80PCT_LIVE_V13.
- Backend release: tf2-solid-80-sop.js serta contract, Telegram, Analysis dan Copilot pada branch release/tf2-solid80.
- test/tf2-solid80.test.js serta validation: bukti ujian 5/6, 4/6, veto HEMA40, ribbon yang dibuang, freshness, Telegram/Copilot dan pause.

## Status penggunaan

Ujian backend dan pemeriksaan struktur Pine bukan kompilasi Pine Editor atau ujian broker. Pine belum dikompilasi/replayed; state intrabar dan exit drawing perlu disahkan. Profit SOP80 belum diuji; tiada order MT5 dihantar. Keputusan rugi SOP3-candle sebelumnya bukan keputusan SOP80.

Jangan ganti alert live sekarang. Fasa sambungan: semak Pine Editor/replay; backend kekal PAUSED; stop alert lama yang bersaing; buat dua instance candidate TF2 yang sama (Dashboard/Execution); sahkan marker, plan, Telegram dan contract. Legacy versions masih ada untuk compatibility, maka aktivasi perlu memastikan feed baharu digunakan.

plannedTf2Policy pada /sop-version menerangkan draf. observedGoldFeed menerangkan feed yang diterima. Backend menyokong versi baharu; penggunaan sebenar bergantung pada marker feed yang diterima. Secret webhook diisi secara private ketika fasa sambungan; tiada password/key dalam ZIP.
