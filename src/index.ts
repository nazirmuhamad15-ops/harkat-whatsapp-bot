// Standalone WhatsApp Bot Service
// Run this separately with: npx tsx scripts/whatsapp-bot.ts

/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-require-imports */

import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import * as http from 'http'
import * as path from 'path'
// @ts-ignore
import qrTerminal from 'qrcode-terminal'

let sock: any = null
let qrCode: string | null = null
let connectionStatus = 'disconnected'

async function startWhatsApp() {
    const authPath = path.resolve(__dirname, '../auth_info_baileys')
    const { state, saveCreds } = await useMultiFileAuthState(authPath)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(`📱 Starting WhatsApp Bot...`)
    console.log(`📦 Using WA v${version.join('.')}, isLatest: ${isLatest}`)

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }) as any,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as any),
        },
        generateHighQualityLinkPreview: true,
        browser: ['Harkat Furniture Bot', 'Chrome', '120.0.0'],
    })

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCode = qr
            connectionStatus = 'scanning'
            console.log('🔲 New QR Code generated! Check http://localhost:8001/qr')
            
            // Also print QR to terminal using ASCII
            qrTerminal.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
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
    
    // Listen for incoming messages (optional - for future bot features)
    sock.ev.on('messages.upsert', async (m: any) => {
        const msg = m.messages[0]
        if (!msg.key.fromMe && m.type === 'notify') {
            console.log(`📨 New message from ${msg.key.remoteJid}:`, msg.message?.conversation || '[media]')
        }
    })
}

// Simple HTTP server to expose status and QR code
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    
    if (req.url === '/status') {
        res.end(JSON.stringify({
            status: connectionStatus,
            qr: qrCode,
            user: sock?.user ? { id: sock.user.id, name: sock.user.name } : null
        }))
    } else if (req.url === '/qr') {
        if (qrCode) {
            res.setHeader('Content-Type', 'text/html')
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
                        p { color: #666; }
                    </style>
                </head>
                <body>
                    <h1>📱 Scan with WhatsApp</h1>
                    <div id="qr"></div>
                    <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                    <script>
                        QRCode.toCanvas(document.getElementById('qr'), '${qrCode}', { width: 300 });
                        setTimeout(() => location.reload(), 30000); // Refresh every 30s
                    </script>
                </body>
                </html>
            `)
        } else {
            res.setHeader('Content-Type', 'text/html')
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
    } else if (req.url?.startsWith('/send') && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
            try {
                console.log('📨 Incoming send request');
                const { jid, message } = JSON.parse(body)
                console.log(`🎯 Target: ${jid}, Message length: ${message?.length}`);
                
                if (!sock) {
                   console.error('❌ Socket is null');
                   res.statusCode = 503;
                   res.end(JSON.stringify({ error: 'WhatsApp socket not initialized' }));
                   return;
                }
                
                if (connectionStatus !== 'connected') {
                    console.error('❌ Status not connected:', connectionStatus);
                    res.statusCode = 503;
                    res.end(JSON.stringify({ error: `WhatsApp not connected (Status: ${connectionStatus})` }));
                    return;
                }
                
                await sock.sendMessage(jid, { text: message })
                console.log('✅ Message sent successfully');
                res.end(JSON.stringify({ success: true }))
            } catch (e: any) {
                console.error('❌ Send Error:', e);
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message }))
            }
        })
    } else {
        res.end(JSON.stringify({ 
            message: 'WhatsApp Bot Service',
            endpoints: ['/status', '/qr', '/send (POST)']
        }))
    }
})

const PORT = process.env.PORT || 8001
server.listen(PORT, () => {
    console.log(`🚀 WhatsApp Bot HTTP Server running on port ${PORT}`)
    console.log(`📊 Status: /status`)
    console.log(`🔲 QR Code: /qr`)
    startWhatsApp()
})
