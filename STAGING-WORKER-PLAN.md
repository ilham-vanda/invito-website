# Invito — rencana staging aman (belum untuk produksi)

Dokumen ini untuk menyiapkan uji coba login admin tanpa mengganti Worker Invito yang sedang aktif.

## Status saat ini

- Dua Worker terlihat di Cloudflare: `invito-web` dan `invito-website`.
- Keduanya menampilkan website Invito dan menggunakan deployment manual.
- Di halaman Builds yang diperiksa, bagian Git repository masih menampilkan tombol Connect.
- Repo `ilham-vanda/invito-website` memiliki cabang `develop` dengan `admin.html`, `admin-auth-worker.js`, dan skrip pembuat hash kata sandi.
- Autentikasi belum terpasang ke Worker aktif, belum diuji di Cloudflare, dan belum diaudit. Jangan masukkan kredensial ke halaman login ini dulu.

## Prinsip wajib

1. Jangan edit, hapus, atau deploy ke `invito-web` maupun `invito-website` untuk pekerjaan ini.
2. Buat Worker staging baru dengan nama berbeda, misalnya `invito-admin-staging`. Jangan gunakan tombol New deployment pada Worker produksi.
3. Jangan hubungkan GitHub atau pilih branch pada Worker produksi. Jika kelak staging dihubungkan ke repo, pilih hanya `develop`.
4. Jangan menyimpan kata sandi asli, hash kata sandi, atau `SESSION_SECRET` dalam GitHub atau file yang dapat diunduh.
5. Jangan arahkan domain produksi atau pengunjung ke staging.
6. Login API saja belum cukup: semua endpoint pengelolaan admin harus memeriksa sesi di server sebelum data dibaca atau diubah.

## Yang harus disiapkan sebelum pengujian

- Worker staging yang terpisah.
- Binding Cloudflare KV khusus staging bernama `RATE_LIMIT_KV`.
- Variable `ADMIN_ID=admin`.
- Secret `ADMIN_PASSWORD_HASH`, dibuat lokal menggunakan `node scripts/generate-admin-password-hash.mjs` dari salinan repo tepercaya.
- Secret acak `SESSION_SECRET` minimal 32 byte.
- Entry point Worker yang mengintegrasikan rute autentikasi dan penyajian halaman secara benar. File `admin-auth-worker.js` saat ini adalah modul API terisolasi, bukan entry point website; jangan deploy file itu sebagai pengganti website.
- Dashboard admin dan API admin yang benar-benar dilindungi sesi. Dashboard pengelolaan penuh belum dibuat.

## Daftar uji sebelum staging dianggap siap

- Worker staging tidak mengubah kedua Worker yang ada.
- Login dengan kata sandi benar berhasil; kata sandi salah ditolak.
- Permintaan tanpa konfigurasi rahasia atau KV ditolak dengan aman.
- Batas percobaan login berlaku.
- Cookie sesi memakai `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- Sesi kedaluwarsa atau palsu ditolak; logout menghapus sesi.
- Semua rute pengelolaan admin menolak permintaan tanpa sesi sah.
- Tidak ada rahasia di source code, log, atau Git.
- Tes manual dan peninjauan kode dicatat sebelum pertimbangan rilis.

## Keputusan rilis

Dokumen ini bukan instruksi untuk menerbitkan ke produksi. Jangan promosikan staging atau ubah Worker produksi sampai pengujian selesai dan pemilik website memberi persetujuan eksplisit.
