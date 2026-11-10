# ZenCore — Himpunan perubahan modul

11 November 2026, MYT. ZenCore original sahaja. Status PAUSED; belum push/merge/deploy. Pakej ini KOD SUMBER untuk semakan dan build, bukan installer siap untuk user.

## Perubahan tersedia dalam sumber

| Modul | Kandungan | Batas pengesahan |
|---|---|---|
| 1 | Admin setup/serahan, pengasingan slot; butang Tukar MT5 berasingan daripada Kosongkan/Master Reset. Tukar MT5 mengekalkan profil, password dan folder, membatalkan token lama, kembali ADMIN_SETUP serta STOPPED dan memerlukan semakan risiko semula. | Tutup semua posisi/pending order dicuba melalui EA. Jika offline atau ditolak, status jelas BELUM DISAHKAN TUTUP. Ujian Windows/broker sebenar belum dibuat. |
| 2 | Entry diproses empat profil serentak; retry Connector berjarak, file-lock sementara dicuba semula dan tidak menggunakan data lama. | Benchmark memori sahaja; bukan jaminan sifar delay atau 100 terminal sebenar. |
| 3 | Handoff kod Connector ke fail EA diuji BUY/SELL TF2/TF15, binding, signature, lease dan payload kekal. | MetaEditor compile, permission Windows dan fill broker belum disahkan. |
| 4 | Management empat profil serentak dan ralat diasingkan; step-lock/close/manual Auto Exit dan flat/re-entry diuji simulasi. | Posisi broker sebenar bukan dibuktikan oleh ACK sahaja. |
| 5 | Telegram ENTRY/RE-ENTRY: harga, ruangan Strength/jangkauan, sebab, analisis Pine ringkas, rumusan dan coach. RSI/HEMA/momentum disalin daripada snapshot signal sendiri. Signal tidak dilabel sebagai order MT5. | Strength/jangkauan dipaparkan —; formula tervalidasi belum tersedia. Skor forecast bukan Strength atau win rate. Tiada mesej Telegram sebenar dihantar dalam sesi. |
| 6 | Senarai amaran aktif kod merah sahaja, fokus kegagalan data, dispatcher/queue dan sambungan MT5 yang sepatutnya ON. Dedup mengikut kod/user/TF. PAUSED dan OFF tidak menghasilkan alarm entry. | Semakan queue masih agregat; sebab khusus setiap kegagalan open/close belum dipetakan sepenuhnya. Snapshot segar yang mengesahkan pulih mengeluarkan amaran. |
| 7 | Tetapan lot/layer TF2/TF15 berasingan, ON/OFF, Auto Exit, jadual dan pengasingan user diuji 100 profil. | Semua klik UI, timeout dan VPS sebenar belum disahkan. Login MT5 automatik belum dibina. |
| 8 | Retention dua bulan kalendar bergulir, baseline 1 November MYT; TP1/2/3 dan SL hanya jika bukti tersedia. | History MT5/deal/ticket/PnL sebenar dan bukti lengkap SL belum dibina. Tiada rekod produksi dipadam dalam sesi. |
| 9 | Skrip build menggunakan versi sumber dan panduan sepadan; semakan aset, slot, folder dan compile-failure protection. | Tiada EXE baharu, compile MetaEditor sebenar, upgrade berjalan atau rollback automatik diuji. |
| Dashboard & UI | Tema navy/biru pada 27 halaman; harga → pelan trade/kad entry → ringkasan TF2/TF15 → carta. Ringkasan enam medan: arah, keadaan, momentum, support, resistance dan panduan. | Data tiada dipaparkan —; support/resistance terdekat memerlukan producer sebenar. UI pelayar belum disahkan. |

## Cara menggunakan pakej

1. Ekstrak kod ke checkout ujian yang berasingan.
2. Semak status dan perubahan; kekalkan ZENCORE_ENTRY_SIGNALS_PAUSED=true serta ZENCORE_ANALYSIS_SIGNALS_PAUSED=true dalam persekitaran ujian/deploy penyelenggaraan. Pakej tidak mengandungi credential/config produksi.
3. Server: Node 20+ dan npm ci, kemudian npm test. Jangan sambungkan ujian kepada database produksi.
4. Connector/Manager: Python dan arahan build Windows dalam ea-local-connector. Bina pada Windows dengan dependency/Inno Setup/MetaEditor yang sesuai. Tiada EXE dibekalkan.
5. Route switch-mt5 dan butang Manager baharu mesti dikemas kini bersama backend; backend lama akan menolak route baharu. Versi sumber Connector/EA terdahulu dikekalkan; ini bukan nombor keluaran installer baharu.
6. Uji demo Windows: folder, EA, lease, pertukaran akaun, partial/full fill dan close sebenar. Aktifkan trading hanya selepas arahan owner dan pengesahan yang sesuai.

## Perkara belum lengkap

- Formula Overall/per-TP Setup Strength serta jangkauan harga dan kalibrasi hasil sebenar.
- Pipeline lengkap History MT5, sebab SL/close, komisen/swap dan PnL.
- Pemantauan berbutir command/ticket untuk membezakan semua kegagalan open daripada close.
- Login MT5 automatik, installer baharu, rollback dan ujian 100 terminal sebenar.
- Ujian visual semua halaman dan penghantaran Telegram sebenar 100 user.

Semua ini dicatat supaya pakej sumber tidak disalah anggap sebagai sistem produksi lengkap atau ramalan yang dijamin tepat.

## Bukti ujian

- Node sebelum pelarasan format akhir: 944 ujian, 932 lulus, 12 PostgreSQL dilangkau; tiada gagal.
- Semakan format baharu memerlukan pelarasan assertion lama yang melarang baris Forecast; baris kini memang diminta oleh owner. Suite penuh akhir direkodkan dalam VALIDATION.txt di akar pakej.
- Python Connector/Manager/EA harness: 118 ujian, 117 lulus, satu DPAPI Windows dilangkau. Termasuk pengasingan slot dan pemeliharaan folder semasa Tukar MT5.
- Semua ujian ini simulasi/kod. Bukan MetaEditor compile atau fill/close broker sebenar.
