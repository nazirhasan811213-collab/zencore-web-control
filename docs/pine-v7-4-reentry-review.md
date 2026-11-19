# ZenCore Pine V7.4 — Semakan entry dan re-entry

Tarikh: 19 November 2026. Status: kod disediakan dan diuji secara tempatan. Belum disahkan oleh compiler TradingView, belum dipasang pada alert pengguna dan belum dibuktikan melalui backtest keuntungan.

## Skop sebenar

Inventori/imbasan statik dibuat terhadap 21 sumber Pine dalam repositori. Semakan logik dan pembetulan terperinci ditumpukan kepada sumber V7 yang digunakan dalam perbincangan ini:

- `ZenCore_TF2_SOP_V7.pine` — V7.3 kepada V7.4, XAUUSD dan BTCUSD.
- `ZenCore_TF15_SOP_V7.pine` — V7.1 kepada V7.4, XAUUSD dan BTCUSD.

Fail lama seperti V6, SolidOnly, Forecast45 dan feed tambahan mempunyai SOP tersendiri. Ia tidak ditukar secara senyap kepada V7.4. Inventori tidak bermaksud semua versi lama telah diuji atau mendapat pembetulan sama. Laluan muat turun lama masih wujud. Jika alert versi lama masih hidup, ia masih boleh menghantar aturan lama.

## Kelemahan yang ditemui dan pembetulan

| Penemuan | Kesan yang mungkin | Pembetulan V7.4 |
|---|---|---|
| Skor TF2 bergantung pada suis struktur/ruang TP1 | Suis OFF turut mematikan penapis kualiti dan membolehkan candle HOLD kelihatan layak | Skor dan candle wajib dinilai. Suis hanya mengawal semakan halangan TP1 |
| Flag had re-entry tidak dikuatkuasakan | Kitaran sambungan boleh berulang dalam SOLID sama | Maksimum satu calon re-entry yang berjaya dilayakkan bagi setiap sumber SOLID |
| Rekod rehat tidak mempunyai had umur | Pullback lama boleh digunakan untuk entry jauh kemudian | Rehat luput selepas tiga candle, kemudian perlu rehat baharu |
| Pecah high/low satu candle sahaja | Candle kecil dalam julat boleh dianggap breakout | Candle mesti tutup melampaui seluruh julat rehat yang dikumpul |
| Badan/wick dan jarak dari ribbon tidak ditapis pada re-entry | Entry boleh mengejar candle besar atau menerima penolakan harga | Tapis badan, kedudukan penutupan dan jarak ATR pada re-entry |
| Cap skor 55 masih boleh lulus minimum 50 walaupun chop tinggi atau majoriti MTF melawan | Skor agregat menutup kelemahan keadaan pasaran | Chop <60 dan sekurang-kurangnya dua daripada tiga arah MTF tidak boleh melawan |
| TF15 lebih longgar pada candle re-entry dan qualification | Kualiti antara TF tidak selaras | Gate kualiti, candle, rehat dan had satu re-entry diterapkan juga pada TF15 |
| TF15 initial qualification bergantung pada detik pulse | Setup yang lengkap pada candle berikutnya boleh terlepas | SOLID yang belum digunakan boleh melayakkan entry pada close berikutnya, dengan bukti held qualification dalam payload |
| TF15 boleh mereset identiti exit lama semasa sumber baharu masuk | Risiko mengganggu pengurusan posisi yang masih berjalan | Identiti exit dikekalkan sehingga posisi virtual tamat dan event exit lama telah dihantar |

## Syarat entry awal

Semua keputusan entry baharu dibuat ketika candle tutup. Sumber SOLID mesti aktif dan belum digunakan. Harga melepasi rujukan SOLID, WT searah, Movement dan HEMA searah, candle native dan OHLC searah. Candle kuning/neutral atau candle melawan menunggu.

Skor minimum kekal 50/100 secara default. Skor dikira untuk arah setup, bukan semata-mata kekuatan pasaran tanpa arah. Ia ialah skor teknikal, bukan kebarangkalian menang 50%.

Data skor MTF menggunakan candle HTF yang telah lengkap: TF2 menggunakan 3/5/10 minit, TF15 menggunakan 30/60/240 minit. Semakan halangan TP1 ON secara default dan boleh diubah tanpa mematikan skor/candle wajib.

Kualiti entry tidak mematikan keputusan exit posisi yang sedang diurus.

## Syarat re-entry

| Perkara | Tetapan/default |
|---|---|
| Posisi sebelumnya | Kitaran virtual sudah tutup. Server tetap perlu mengesahkan posisi MT5 bagi akaun itu sudah kosong |
| Had | Sekali per sumber SOLID, bukan sekali setiap kali harga berubah |
| Sumber | SOLID yang sama masih aktif dan arah masih sepadan |
| Rehat baharu | Selepas masa tutup kitaran, pullback minimum 0.25 ATR atau julat dua candle <=0.75 ATR |
| Masa breakout | Selepas candle rehat, dalam tiga candle berikutnya |
| Breakout | Close BUY melepasi high seluruh rehat, atau close SELL melepasi low seluruh rehat |
| Badan candle | Sekurang-kurangnya 35% julat candle |
| Kedudukan close | Sekurang-kurangnya 65% ke arah entry dalam julat candle |
| Elak mengejar | Badan dan jarak close dari tepi ribbon terdekat tidak melebihi 1.5 ATR |
| Sambungan trend | Ribbon searah, HEMA cepat bergerak searah dan WT1 tidak melemah ke arah bertentangan |
| Kualiti semasa | Semua syarat kualiti entry dinilai pada candle re-entry |

ATR di sini menormalkan penapis re-entry mengikut skala harga. Ia tidak menukar TP/SL BTC kepada ATR. Default baharu ialah heuristik yang boleh diuji dan dilaras, belum dioptimumkan pada data keuntungan.

Apabila rehat luput, skrip membuang julat dan masa rehat lama. Ia tidak terus menghantar arahan kerana harga masih searah. Paparan membezakan menunggu pullback, menunggu pecah julat, candle lemah, terlalu jauh dan kuota sudah digunakan.

## Perkara yang dikekalkan dan had penting

- TF2 terus menggunakan sumber SOLID mengikut perubahan HEMA pada candle tutup yang diperkenalkan dalam V7.3.
- TF15 mengekalkan pencetus native SOLID sendiri. Ia tidak ditukar menjadi pencetus HEMA TF2.
- Struktur paket 67 medan, satu panggilan `alert()`, identiti event dan retry sedia ada dikekalkan.
- Blok keputusan exit dan pengiraan step-lock dibandingkan secara tepat dengan baseline: tiada perubahan dalam pembetulan ini.
- Jarak SL/TP sedia ada dikekalkan. TF2 BTC: 1 pip = 10 unit harga, SL 300, TP1 150, TP2 250, TP3 400 dari entry. TF15 mengekalkan aturan ATR14 tersendiri.
- Ini bukan pengesahan bahawa semua SOP exit lama sama dengan semua permintaan sejarah. Contohnya kod Pine sedia ada menganggap pulse native “Close Separuh” sebagai event CLOSE ALL. Semakan exit menyeluruh dan penyelarasan partial profit perlu dibuat berasingan sebelum mendakwa SOP 50% TP1 telah lengkap.
- Pine tidak menerima fill broker atau pengesahan MT5 flat secara terus. Penutupan virtual dan penutupan sebenar boleh berbeza. Semakan backend mendapati laluan Pine Direct memintas semakan posisi biasa dalam `auto-trade-service.js` dan `entry-delivery-check.js`. Maka tidak boleh mendakwa server sudah mengesahkan flat bagi semua arahan Direct. Pakej Pine ini tidak mengubah backend/EA. Pengesahan broker-flat bagi FOLLOWUP perlu diselaraskan di sana sebelum menjamin tiada pertindihan apabila virtual Pine dan posisi broker berbeza.
- Semakan pivot TP1 mengimbas pivot yang telah lengkap pada 14 candle sebelumnya. Ia bukan jaminan tiada halangan pasaran di luar julat ini.
- Komponen dashboard lain masih menggunakan data HTF live di bahagian analisis lama. Hanya komponen MTF penapis kualiti baharu secara khusus menggunakan bar HTF lengkap. Tiada dakwaan keseluruhan indikator bebas repaint dibuat.

## Risiko prestasi yang belum diselesaikan oleh skor

Menapis entry lemah boleh mengurangkan kekerapan dagangan tetapi belum membuktikan kerugian keseluruhan menurun. Contohnya SL XAU sehingga 4.00 dan TP1 sehingga 1.50 memerlukan win rate sekitar 72.7% sebelum kos jika semua dagangan ditutup sepenuhnya hanya pada TP1. Partial exit dan runner mengubah kiraan itu. Maka skor 50 sahaja tidak mencukupi untuk membuktikan jangkaan keuntungan positif.

Tiada dataset sejarah tick/OHLC lengkap, spread broker, komisen, slippage atau rekod dagangan akaun digunakan dalam tugas ini. Tiada angka win rate, profit factor atau drawdown dicipta. Ujian logik mengesahkan keputusan yang dimaksudkan, bukan hasil kewangan.

Sebelum live, bandingkan V7.3 dan V7.4 pada data dan kos sama, asingkan XAU/BTC dan TF2/TF15. Ukur net expectancy, profit factor, drawdown, purata untung/rugi dan hasil re-entry secara berasingan daripada entry pertama. Gunakan tempoh ujian yang berbeza daripada tempoh memilih parameter. Had re-entry satu kali dan window tiga candle juga boleh menolak peluang yang kemudian untung, jadi perlu dinilai sebagai pertukaran risiko dan peluang.

## Pengesahan yang dibuat

112 ujian logik/integrasi lulus. 22 ujian baharu menjalankan ekspresi gate produksi dan blok keadaan rehat produksi dalam harness JavaScript: BUY/SELL, TF2/TF15, stale pause, pecah candle kecil tanpa pecah julat, wick lemah, mengejar harga, skor hilang/rendah, MTF melawan, chop tinggi, kuota, candle belum tutup dan event exit belum dihantar.

Ujian integrasi sedia ada meliputi format Pine ke server, deduplikasi, dispatch XAU/BTC dan mailbox Connector simulasi. Ini bukan order sebenar pada broker. Semakan delimiter/string Pine lulus. Compiler TradingView belum dijalankan.

## Cara menggunakan

1. Tambah TF2 V7.4 pada carta 2 minit. Untuk TF15, gunakan fail TF15 V7.4 pada carta 15 minit. Gunakan carta harga biasa.
2. Semak input: skor 50, semak ruang TP1 ON, pullback 0.25, julat rehat 0.75, maksimum rehat tiga candle dan jarak ribbon 1.5. Tetapkan channel dan secret webhook sedia ada tanpa berkongsi secret.
3. Compile dalam Pine Editor. Jika ada ralat compiler, jangan aktifkan alert versi itu sehingga dibetulkan.
4. Padam atau hentikan alert Execution lama bagi pair/TF yang diganti. Cipta semula alert V7.4 menggunakan webhook sedia ada. Alert TradingView menyimpan snapshot skrip dan input, jadi menukar carta sahaja tidak mengemas kini alert lama.
5. Semak Demo dahulu: setup INITIAL, posisi tamat, rehat baharu, re-entry sekali dan tiada order tambahan daripada retry event sama.

Pakej ini tidak memasang Pine ke akaun TradingView dan tidak menukar alert atau posisi live secara automatik.

## Rujukan teknikal

- TradingView, [Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/): pola nilai HTF lengkap menggunakan offset `[1]` bersama `lookahead_on`.
- TradingView, [Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/): kos dagangan, slippage dan batas simulasi.
- TradingView, [Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/): alert menyimpan snapshot skrip dan input.
