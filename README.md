# SIMKEU YAYASAN v1

Frontend awal SIMKEU Yayasan yang sudah terhubung ke Supabase.

## Aktif
- Login Supabase Authentication
- Membaca role dari `profiles`
- Dashboard real-time
- Total saldo dari `v_account_balances`
- Pemasukan & pengeluaran bulan berjalan
- Transaksi menunggu approval
- Saldo per lembaga
- Grafik arus kas
- Diagram pengeluaran
- Transaksi terbaru
- Responsive HP/laptop

## Tahap berikutnya
Menu transaksi (Pemasukan, Pengeluaran, Transfer Internal, Bukti Transaksi,
Lembaga, Laporan, Analitik, Pengguna) sudah disiapkan tetapi belum diaktifkan.

## Deploy GitHub + Vercel
1. Buat repository GitHub: `simkeu-yayasan`
2. Upload:
   - index.html
   - styles.css
   - app.js
3. Buka Vercel > Add New > Project.
4. Import repository.
5. Framework Preset: Other.
6. Build Command: kosong.
7. Output Directory: kosong.
8. Deploy.

## Keamanan
Publishable key boleh berada di frontend. Jangan pernah memasukkan service_role
atau secret key. Perlindungan data dilakukan oleh Supabase Auth + RLS.
