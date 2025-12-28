const makeWASocket = require('@whiskeysockets/baileys').default
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
const pino = require('pino')
const http = require('http')
const path = require('path')
const qrTerminal = require('qrcode-terminal')

let sock = null
let qrCode = null
let connectionStatus = 'disconnected'

async function startWhatsApp() {
    const authPath = path.resolve(__dirname, 'auth_info')
    const { state, saveCreds } = await useMultiFileAuthState(authPath)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(`📱 Starting WhatsApp Bot...`)
    console.log(`📦 Using WA v${version.join('.')}, isLatest: ${isLatest}`)

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        generateHighQualityLinkPreview: true,
        browser: ['Harkat Furniture Bot', 'Chrome', '120.0.0'],
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCode = qr
            connectionStatus = 'scanning'
            console.log('🔲 New QR Code generated!')
            qrTerminal.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            console.log('❌ Connection closed, status:', statusCode)
            connectionStatus = 'disconnected'
            qrCode = null
            
            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 5 seconds...')
                setTimeout(startWhatsApp, 5000)
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected!')
            console.log(`👤 Logged in as: ${sock.user?.name || sock.user?.id}`)
            connectionStatus = 'connected'
            qrCode = null
        }
    })

    sock.ev.on('creds.update', saveCreds)
    
    // Auto-reply configuration
    const AUTO_REPLIES = {
        // Greetings
        'halo': 'Halo! 👋 Selamat datang di Harkat Furniture.\n\nKetik angka untuk info:\n1. Jadwal operasional\n2. Cara order\n3. Cek status pesanan\n4. Alamat toko\n5. Hubungi CS',
        'hai': 'Halo! 👋 Selamat datang di Harkat Furniture.\n\nKetik angka untuk info:\n1. Jadwal operasional\n2. Cara order\n3. Cek status pesanan\n4. Alamat toko\n5. Hubungi CS',
        'hi': 'Halo! 👋 Selamat datang di Harkat Furniture.\n\nKetik angka untuk info:\n1. Jadwal operasional\n2. Cara order\n3. Cek status pesanan\n4. Alamat toko\n5. Hubungi CS',
        'selamat pagi': 'Selamat pagi! ☀️ Ada yang bisa kami bantu?',
        'selamat siang': 'Selamat siang! 🌤️ Ada yang bisa kami bantu?',
        'selamat sore': 'Selamat sore! 🌅 Ada yang bisa kami bantu?',
        'selamat malam': 'Selamat malam! 🌙 Ada yang bisa kami bantu?',
        
        // Menu options
        '1': '🕐 *Jadwal Operasional*\n\nSenin - Jumat: 09.00 - 18.00\nSabtu: 09.00 - 15.00\nMinggu & Libur: Tutup',
        '2': '🛒 *Cara Order*\n\n1. Kunjungi website kami\n2. Pilih produk yang diinginkan\n3. Tambahkan ke keranjang\n4. Checkout dan pilih metode pembayaran\n5. Tunggu konfirmasi dari kami\n\n🌐 Website: harkatfurniture.com',
        '3': '📦 *Cek Status Pesanan*\n\nSilakan kirimkan nomor order Anda dengan format:\n\nCEK ORD-XXXXXX\n\nContoh: CEK ORD-123456',
        '4': '📍 *Alamat Toko*\n\nHarkat Furniture\nJl. Furniture No. 123\nJakarta Selatan 12345\n\nGoogle Maps: https://maps.google.com',
        '5': '📞 *Hubungi Customer Service*\n\nTim CS kami akan segera menghubungi Anda.\n\nUntuk respon lebih cepat, silakan jelaskan:\n- Nama lengkap\n- Nomor order (jika ada)\n- Pertanyaan/keluhan Anda',
        
        // Common questions
        'harga': 'Untuk informasi harga, silakan kunjungi website kami di harkatfurniture.com atau ketik nama produk yang ingin Anda tanyakan.',
        'ongkir': '🚚 *Info Ongkir*\n\n- Jabodetabek: Gratis ongkir untuk pembelian min. Rp 5.000.000\n- Luar Jabodetabek: Dihitung berdasarkan berat & lokasi\n\nKetik alamat lengkap Anda untuk estimasi ongkir.',
        'promo': '🎉 *Promo Terbaru*\n\nCek promo terbaru di website kami!\n\n🌐 harkatfurniture.com/promo',
        'terima kasih': 'Sama-sama! 🙏 Jangan ragu hubungi kami jika ada pertanyaan lain.',
        'terimakasih': 'Sama-sama! 🙏 Jangan ragu hubungi kami jika ada pertanyaan lain.',
        'makasih': 'Sama-sama! 🙏 Jangan ragu hubungi kami jika ada pertanyaan lain.',
        'thanks': 'Sama-sama! 🙏 Jangan ragu hubungi kami jika ada pertanyaan lain.',
    }

    // Listen for incoming messages with auto-reply
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase().trim()
            const sender = msg.key.remoteJid
            
            console.log(`📨 New message from ${sender}:`, text)
            
            // Check for auto-reply match
            let reply = null
            
            // Exact match first
            if (AUTO_REPLIES[text]) {
                reply = AUTO_REPLIES[text]
            } else {
                // Partial match
                for (const [keyword, response] of Object.entries(AUTO_REPLIES)) {
                    if (text.includes(keyword)) {
                        reply = response
                        break
                    }
                }
            }
            
            // Check for order status query
            if (text.startsWith('cek ord-') || text.startsWith('cek #ord-')) {
                const orderNum = text.replace('cek ', '').replace('#', '').toUpperCase()
                reply = `📦 *Status Pesanan ${orderNum}*\n\nUntuk cek status pesanan secara real-time, silakan:\n\n1. Kunjungi: harkatfurniture.com/track\n2. Masukkan nomor order: ${orderNum}\n\nAtau tunggu CS kami menghubungi Anda.`
            }
            
            // Send auto-reply if found
            if (reply && sender) {
                try {
                    await sock.sendMessage(sender, { text: reply })
                    console.log(`🤖 Auto-reply sent to ${sender}`)
                } catch (err) {
                    console.error('Auto-reply error:', err)
                }
            }
        }
    })
}

// HTTP server for status and sending messages
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200)
        res.end()
        return
    }
    
    if (req.url === '/status') {
        res.end(JSON.stringify({
            status: connectionStatus,
            qr: qrCode,
            user: sock?.user ? { id: sock.user.id, name: sock.user.name } : null
        }))
    } else if (req.url === '/qr') {
        res.setHeader('Content-Type', 'text/html')
        if (qrCode) {
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
                    <style>
                        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
                        h1 { color: #25D366; }
                        #qr { padding: 20px; background: white; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
                        canvas { display: block; }
                    </style>
                </head>
                <body>
                    <h1>📱 Scan with WhatsApp</h1>
                    <div id="qr"><canvas id="canvas"></canvas></div>
                    <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                    <script>QRCode.toCanvas(document.getElementById('canvas'), '${qrCode}', { width: 300 }); setTimeout(() => location.reload(), 30000);</script>
                </body>
                </html>
            `)
        } else {
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>WhatsApp Status</title></head>
                <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh;">
                    <h1>${connectionStatus === 'connected' ? '✅ Connected!' : '⏳ Waiting for QR...'}</h1>
                    <p>Status: ${connectionStatus}</p>
                    <script>setTimeout(() => location.reload(), 3000);</script>
                </body>
                </html>
            `)
        }
    } else if (req.url === '/send' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
            try {
                const { jid, message } = JSON.parse(body)
                if (!sock || connectionStatus !== 'connected') {
                    res.statusCode = 503
                    res.end(JSON.stringify({ error: 'WhatsApp not connected' }))
                    return
                }
                await sock.sendMessage(jid, { text: message })
                res.end(JSON.stringify({ success: true }))
            } catch (e) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message }))
            }
        })
    } else if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, status: connectionStatus }))
    } else {
        res.end(JSON.stringify({ 
            message: 'Harkat Furniture WhatsApp Bot',
            endpoints: ['/status', '/qr', '/send (POST)', '/health']
        }))
    }
})

const PORT = process.env.PORT || 8001
server.listen(PORT, () => {
    console.log(`🚀 WhatsApp Bot running on port ${PORT}`)
    console.log(`📊 Status: /status`)
    console.log(`🔲 QR Code: /qr`)
    startWhatsApp()
})
