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
    
    // Listen for incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log(`📨 New message from ${msg.key.remoteJid}:`, msg.message?.conversation || '[media]')
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
