# Panduan Setup Cloudflare R2 / AWS S3 untuk Dataset D'Maps Indonesia

Dokumen ini menjelaskan langkah-langkah menyediakan dan menghubungkan **Cloudflare R2** (atau AWS S3 / MinIO) untuk menampung seluruh dataset 38 provinsi di Indonesia secara eksternal, sehingga deployment Vercel tetap **100% statis (0 serverless functions)** dan bebas dari batas ukuran memori.

---

## 1. Mengapa Cloudflare R2?

- **Gratis 10 GB Storage per bulan** (cukup untuk menampung seluruh provinsi di Indonesia).
- **Zero Egress Fees (0 Rupiah Biaya Bandwidth Unduhan)**: Berbeda dengan AWS S3 atau Google Cloud Storage yang mengenakan biaya per GB unduhan pengguna, Cloudflare R2 gratis tanpa biaya transfer keluar.
- **Performa Tinggi**: Terhubung langsung ke jaringan Cloudflare Global CDN, cepat diakses dari seluruh operator seluler di Indonesia.

---

## 2. Membuat Bucket di Cloudflare R2

1. Buka dashboard Cloudflare: [https://dash.cloudflare.com/](https://dash.cloudflare.com/)
2. Masuk ke menu **R2** di sebelah kiri.
3. Klik **Create bucket**, beri nama: `dmaps-data`.
4. Pilih lokasi terdekat (misal: *APAC - Asia Pacific* atau *Automatic*).
5. Klik **Create Bucket**.

---

## 3. Konfigurasi CORS (Penting)

Browser web memerlukan header CORS (*Cross-Origin Resource Sharing*) untuk mengizinkan aplikasi D'Maps mengunduh file biner peta (`graph.bin`, `places.json`, dll.).

1. Di dalam bucket `dmaps-data`, buka tab **Settings**.
2. Scroll ke bagian **CORS Policy** dan klik **Add CORS policy**.
3. Masukkan konfigurasi JSON berikut:

```json
[
  {
    "AllowedOrigins": [
      "*"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type"
    ],
    "MaxAgeSeconds": 3600
  }
]
```
4. Klik **Save**.

---

## 4. Mengaktifkan Akses Publik (Public Access)

1. Masih di tab **Settings** bucket R2.
2. Scroll ke bagian **Public Access**.
3. Anda dapat memilih salah satu:
   - **Custom Domain** (Direkomendasikan): Hubungkan subdomain Anda, misal `data.dmaps.id` atau `maps-data.yourdomain.com`.
   - **R2.dev Subdomain**: Klik **Allow Access**, lalu Anda akan mendapatkan URL publik gratis seperti `https://pub-abcdef123456.r2.dev`.

---

## 5. Struktur Folder di Dalam Bucket

Setiap provinsi yang diunggah ke bucket harus mengikuti struktur folder per ID provinsi:

```
dmaps-data/
  ├── jambi/
  │    ├── manifest.json
  │    ├── graph.bin
  │    ├── ways.json
  │    ├── places.json
  │    ├── features.json
  │    └── turns.bin
  ├── bali/
  │    ├── manifest.json
  │    ├── graph.bin
  │    └── ...
  ├── yogyakarta/
  └── ... (provinsi lainnya)
```

---

## 6. Sinkronisasi Data ke Bucket R2

Gunakan skrip pembantu di repositori ini:

```bash
# Tampilkan panduan sync
python scripts/build_indonesia.py --sync-r2 --bucket dmaps-data
```

Atau menggunakan AWS CLI dengan endpoint R2:
```bash
aws s3 sync public/data/ s3://dmaps-data/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --exclude "catalog.json"
```

---

## 7. Menghubungkan ke Web App di Vercel

1. Buka dashboard Vercel pada proyek Anda: **Settings** -> **Environment Variables**.
2. Tambahkan variable:
   - **Key**: `VITE_STORAGE_BASE_URL`
   - **Value**: URL publik bucket Anda (misal `https://pub-abcdef123456.r2.dev` atau `https://data.dmaps.id`)
3. Klik **Save** dan lakukan **Redeploy**.

Sekarang, saat pengguna membuka menu **Offline Map Manager** di aplikasi D'Maps dan memilih provinsi manapun, aplikasi akan otomatis mengunduh data biner dari Cloudflare R2 secara cepat, aman, dan dapat digunakan 100% offline!
