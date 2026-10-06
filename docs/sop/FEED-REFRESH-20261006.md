# Pembetulan kemaskini analysis TF2 / TF15

Masalah kod: feed hanya dihantar apabila SOLID/eligibility berubah atau candle tutup. HEMA/checklist semasa boleh berubah ketika eligibility kekal false tanpa menghantar snapshot baharu.

Log 6 Oktober: alert TF2 11:32:00.537 MYT diterima 11:32:01.871 dan 11:32:02.284. Alert 11:30:00.498 diterima 11:30:09.706; satu lagi 11:30:00.497 diterima 11:30:11.985. Ini menunjukkan kelewatan penghantaran dan alert berulang; belum membuktikan duplicate alert datang daripada chart/instance mana.

Pembetulan:

- Feed menghantar apabila keadaan pengesahan SOP berubah walaupun entry masih belum layak.
- Snapshot heartbeat 20 saat pada tick realtime yang tersedia.
- Had maksimum 14 penghantaran dalam rolling 3 minit; rutin hanya menggunakan 10 slot dan baki diberi kepada entry/perubahan gate/candle close. Ini mengelakkan melebihi had alert TradingView; semasa kadar sangat tinggi penghantaran boleh menunggu slot.
- Dashboard membezakan usia data Pine dengan masa penghantaran ke server.
- Snapshot Pine berusia lebih 30 saat dilabel DATA LAMA walaupun baru diterima; gate sejarah tidak lagi kelihatan sebagai pengesahan aktif.
- Keenam-enam syarat SOP, ATR40, lot/layer dan exit tidak diubah.

Pine baharu mesti dipasang dan alert dicipta semula. Alert lama menyimpan script terdahulu. Guna satu alert batch TF2 dan satu TF15 bagi sumber yang dipilih; semak alert lama yang bertindih dahulu sebelum menutupnya. Pine belum dikompilasi dalam TradingView oleh proses ini. 70 ujian Node berkaitan lulus; ujian tersebut tidak membuktikan kompilasi atau latency Pine/MT5.

Gambar chart menunjukkan label HTF HEMA (W), sedangkan feed TF2 menggunakan HEMA5 bagi komponen checklist HTF. Perbezaan input/script chart perlu disahkan berasingan; heartbeat tidak menjamin dua script dengan input berbeza menghasilkan checklist/forecast yang sama.
