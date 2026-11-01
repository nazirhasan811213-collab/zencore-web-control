# ZenCore tapak 20 user — pemasangan dalam VM sahaja

Pakej ini menyediakan tapak kosong, bukan Host Manager penuh. Ia belum dipasang atau diuji dalam VM pengguna. Tiada akaun broker, pairing atau auto trade diaktifkan. Kapasiti 20 client belum disahkan.

## Cara pemasangan oleh pengendali

1. Jalankan `Assess-ZenCoreVM.ps1` dalam VM untuk mendapatkan OS, CPU, RAM, ruang kosong dan bilangan proses. Laporan tidak membaca password atau nombor akaun.
2. Ekstrak ZIP pada Windows VM. Klik kanan `SETUP-20-SLOTS.cmd` dan pilih Run as administrator. Pemasang mencari folder InterStellar MT5; jika tidak ditemui, pilih folder program MT5 yang mempunyai terminal64.exe dan metaeditor64.exe.
3. Pemasang menggunakan folder baharu `C:\ProgramData\ZenCore\HostedEA20`. Folder/identiti yang sudah wujud tidak ditimpa. Worker lama tidak dihentikan atau diubah.
4. Pemasang mencipta 20 identiti Windows DISABLED, folder terminal berasingan, konfigurasi tanpa credential dan EA. MetaEditor mengkompilasi EA untuk setiap slot. Kegagalan kompilasi menghentikan pemasangan dan slot kekal disabled.
5. Semak `inventory.json`: mesti 20 slot, installationComplete true, eaCompiled true dan executionEnabled false. Ini pengesahan pemasangan sahaja; belum membuktikan EA attach atau sambungan broker.

Jika polisi PowerShell/Windows menyekat skrip, minta pengendali Windows menyemak polisi berkenaan. Pakej tidak menukar execution policy, firewall, RDP atau keselamatan VM.

## Apa yang masih perlu sebelum seorang client aktif

- Tetapkan dan aktifkan identiti Windows slot melalui aliran pentadbiran Windows yang selamat. Jangan gunakan satu profil Windows untuk 20 Connector: paired.dpapi dan Common Files Connector sedia ada adalah per profil.
- Jalankan pemasang Connector 1.31 di dalam profil slot yang betul. Sumber installer sama untuk semua client; pairing tetap berasingan.
- Login MT5 menggunakan akaun/server/password broker dalam sesi slot tersebut. Jangan masukkan password dalam inventory, command line, fail INI, chat atau log.
- Pautkan Connector kepada user ZenCore yang betul. ID broker sahaja tidak menentukan user ZenCore penerima signal.
- Buka terminal dengan /portable dan terminal-scaffold.ini, sahkan simbol broker XAUUSD atau aliasnya, EA attach serta heartbeat. AllowLiveTrading=0 mesti kekal sehingga semua binding disahkan.
- Selepas semakan binding, pengendali tetapkan izin Algo Trading yang diperlukan dan client pilih ON melalui web. Uji DEMO berperingkat 1, 5, 10, 20 slot; jangan menggunakan order REAL untuk ujian beban.

Channel sebenar EA 1.30 dijana selepas login daripada akaun, server dan mod. Slot s01–s20 ialah tapak reservation, bukan channel broker yang sudah tersambung. Channel berasingan bagi profil Windows dan semakan account/session/lease mencegah arahan bertukar akaun; pengasingan ini mesti diuji pada VM.

Tiada scheduled task, auto-login, auto restart, tunnel, Windows session manager atau API onboarding credential ditambah oleh pakej ini. Windows GUI session dan pemulihan selepas reboot masih memerlukan komponen Host Manager yang berasingan. Pakej tidak menjamin privasi terhadap pentadbir Windows yang mempunyai kuasa penuh.

Jika pemasangan gagal, jangan jalankan semula dengan menimpa folder lama. Semak inventory dan compile log, pulihkan hanya slot kosong yang baru dicipta selepas pengendali mengesahkan ia belum digunakan.

Rujukan format MT5 /portable dan startup: https://www.metatrader5.com/en/terminal/help/start_advanced/start
