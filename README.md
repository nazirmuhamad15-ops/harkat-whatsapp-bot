# Harkat Furniture WhatsApp Bot

WhatsApp Bot untuk Harkat Furniture menggunakan Baileys.

## Deploy ke Railway

### 1. Buat akun Railway
- Kunjungi [railway.app](https://railway.app)
- Login dengan GitHub

### 2. Push folder ini ke GitHub
```bash
cd whatsapp-bot
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/harkat-whatsapp-bot.git
git push -u origin main
```

### 3. Deploy di Railway
1. Klik **"New Project"**
2. Pilih **"Deploy from GitHub repo"**
3. Pilih repository `harkat-whatsapp-bot`
4. Railway akan otomatis detect Node.js dan deploy

### 4. Konfigurasi
- Railway akan memberikan URL seperti: `https://harkat-whatsapp-bot.up.railway.app`
- Buka `/qr` untuk scan QR code
- Update `WHATSAPP_BOT_URL` di project utama

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Info |
| `/status` | GET | Status koneksi & QR code |
| `/qr` | GET | Halaman QR code |
| `/send` | POST | Kirim pesan |
| `/health` | GET | Health check |

## Mengirim Pesan

```bash
curl -X POST https://YOUR_URL/send \
  -H "Content-Type: application/json" \
  -d '{"jid": "628123456789@s.whatsapp.net", "message": "Hello!"}'
```

## Environment Variables (Opsional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8001 | Port server |

## Session Persistence

Session WhatsApp disimpan di folder `auth_info/`. Di Railway, session akan persist selama tidak di-redeploy.

Untuk backup session:
1. Download folder `auth_info/` dari Railway
2. Simpan di tempat aman
3. Upload kembali jika perlu restore
