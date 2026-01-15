// ... (Initial imports)
const makeWASocket = require('@whiskeysockets/baileys').default
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
const pino = require('pino')
const http = require('http')
const path = require('path')
const qrTerminal = require('qrcode-terminal')

// Configuration
const API_KEY = process.env.WA_API_KEY || 'harkat-secret-key' // Simple Security
const PORT = process.env.PORT || 8001

let sock = null
let qrCode = null
let connectionStatus = 'disconnected'
let userProfile = null
const messageLogs = [] // Store last 20 messages for dashboard

function logMessage(type, to, status, content) {
    messageLogs.unshift({ time: new Date().toISOString(), type, to, status, content })
    if (messageLogs.length > 50) messageLogs.pop()
}

async function startWhatsApp() {
    const authPath = path.resolve(__dirname, 'auth_info')
    const { state, saveCreds } = await useMultiFileAuthState(authPath)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(`📱 Starting WhatsApp Gateway...`)
    
    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // We serve it via web
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        generateHighQualityLinkPreview: true,
        browser: ['Harkat Gateway', 'Chrome', '120.0.0'],
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCode = qr
            connectionStatus = 'scanning'
            console.log('🔲 New QR Code generated!')
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            console.log('❌ Connection closed, status:', statusCode)
            connectionStatus = 'disconnected'
            qrCode = null
            userProfile = null
            
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...')
                setTimeout(startWhatsApp, 3000)
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected!')
            connectionStatus = 'connected'
            qrCode = null
            userProfile = {
                id: sock.user?.id,
                name: sock.user?.name || 'Harkat Admin'
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)
    
    // Auto-reply logic (Simplified for Gateway focus)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim()
            const sender = msg.key.remoteJid
            // Log incoming
            logMessage('INCOMING', sender.split('@')[0], 'RECEIVED', text.substring(0, 20) + '...')
            // Auto-reply logic can be re-enabled here if needed
        }
    })
}

// Helper to format phone number to JID
const formatJid = (phone) => {
    let clean = phone.replace(/[^0-9]/g, '')
    if (clean.startsWith('0')) clean = '62' + clean.substring(1)
    if (!clean.endsWith('@s.whatsapp.net')) clean += '@s.whatsapp.net'
    return clean
}

// HTTP Server
const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    // AUTH CHECK (Skip for Dashboard assets/view)
    const isApiRequest = req.url.startsWith('/api/') || req.url === '/send' || req.url === '/send-business'
    if (isApiRequest) {
        const authHeader = req.headers['authorization']
        const providedKey = req.headers['x-api-key'] || (authHeader ? authHeader.split(' ')[1] : null)
        
        // Optional: Enforce API Key
        // if (providedKey !== API_KEY) {
        //    res.writeHead(401, { 'Content-Type': 'application/json' })
        //    res.end(JSON.stringify({ status: false, error: 'Unauthorized' }))
        //    return
        // }
    }

    // 1. DASHBOARD UI (Root)
    if (req.url === '/' || req.url === '/dashboard') {
        res.setHeader('Content-Type', 'text/html')
        res.end(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Harkat Gateway Dashboard</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
            </head>
            <body class="bg-gray-100 min-h-screen">
                <div class="container mx-auto px-4 py-8">
                    <!-- Header -->
                    <div class="bg-white rounded-lg shadow-sm p-6 mb-6 flex justify-between items-center">
                        <div>
                            <h1 class="text-2xl font-bold text-gray-800">Harkat WA Gateway</h1>
                            <p class="text-gray-500">Local Kirim.Chat Alternative</p>
                        </div>
                        <div class="flex items-center gap-2">
                             <div id="status-badge" class="px-4 py-2 rounded-full text-sm font-semibold bg-gray-200 text-gray-600">
                                Connecting...
                             </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <!-- Left: Device Status / QR -->
                        <div class="md:col-span-1 bg-white rounded-lg shadow-sm p-6 flex flex-col items-center justify-center min-h-[300px]">
                            <div id="qr-container" class="hidden text-center">
                                <canvas id="qr-canvas"></canvas>
                                <p class="mt-4 text-sm text-gray-500">Scan this QR to link device</p>
                            </div>
                            <div id="profile-container" class="hidden text-center">
                                <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto">
                                    📱
                                </div>
                                <h3 id="profile-name" class="font-bold text-lg">Connected</h3>
                                <p id="profile-id" class="text-gray-500 text-sm mb-4">...</p>
                                <button onclick="logout()" class="px-4 py-2 bg-red-50 text-red-600 rounded hover:bg-red-100 text-sm">Disconnect</button>
                            </div>
                            <div id="loader" class="animate-pulse flex space-x-4">
                               <div class="flex-1 space-y-4 py-1">
                                 <div class="h-4 bg-gray-200 rounded w-3/4"></div>
                                 <div class="space-y-3">
                                   <div class="grid grid-cols-3 gap-4">
                                     <div class="h-4 bg-gray-200 rounded col-span-2"></div>
                                     <div class="h-4 bg-gray-200 rounded col-span-1"></div>
                                   </div>
                                 </div>
                               </div>
                            </div>
                        </div>

                        <!-- Right: Logs & Stats -->
                        <div class="md:col-span-2 bg-white rounded-lg shadow-sm p-6">
                            <h2 class="font-bold text-gray-700 mb-4">Recent Activity</h2>
                            <div class="overflow-x-auto">
                                <table class="w-full text-sm text-left text-gray-500">
                                    <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                                        <tr>
                                            <th class="px-4 py-3">Time</th>
                                            <th class="px-4 py-3">Type</th>
                                            <th class="px-4 py-3">To/From</th>
                                            <th class="px-4 py-3">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody id="logs-body">
                                        <!-- Logs injected here -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    
                    <!-- API Docs -->
                    <div class="mt-6 bg-white rounded-lg shadow-sm p-6">
                        <h2 class="font-bold text-gray-700 mb-2">API Usage</h2>
                        <code class="block bg-gray-800 text-green-400 p-4 rounded text-sm font-mono overflow-x-auto">
                            POST /api/messages<br>
                            Authorization: Bearer ${API_KEY}<br>
                            Content-Type: application/json<br>
                            <br>
                            {<br>
                              "phone_number": "62812345678",<br>
                              "message": "Hello World",<br>
                              "device_id": "iphone-1 (optional)"<br>
                            }
                        </code>
                    </div>
                </div>

                <script>
                    function updateDashboard() {
                        fetch('/health').then(r => r.json()).then(data => {
                            const badge = document.getElementById('status-badge');
                            const loader = document.getElementById('loader');
                            const qrCont = document.getElementById('qr-container');
                            const profCont = document.getElementById('profile-container');
                            
                            loader.classList.add('hidden');
                            
                            if (data.status === 'connected') {
                                badge.className = "px-4 py-2 rounded-full text-sm font-semibold bg-green-100 text-green-600";
                                badge.innerText = "Online";
                                qrCont.classList.add('hidden');
                                profCont.classList.remove('hidden');
                                document.getElementById('profile-name').innerText = data.user?.name || 'Session Active';
                                document.getElementById('profile-id').innerText = data.user?.id || '';
                            } else if (data.status === 'scanning' && data.qr) {
                                badge.className = "px-4 py-2 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-600";
                                badge.innerText = "Scan QR";
                                profCont.classList.add('hidden');
                                qrCont.classList.remove('hidden');
                                QRCode.toCanvas(document.getElementById('qr-canvas'), data.qr, { width: 200 });
                            } else {
                                badge.className = "px-4 py-2 rounded-full text-sm font-semibold bg-red-100 text-red-600";
                                badge.innerText = "Disconnected";
                            }
                            
                            // Logs
                            const logsHtml = data.logs.map(log => \`
                                <tr class="border-b">
                                    <td class="px-4 py-2">\${new Date(log.time).toLocaleTimeString()}</td>
                                    <td class="px-4 py-2">\${log.type}</td>
                                    <td class="px-4 py-2">\${log.to}</td>
                                    <td class="px-4 py-2">
                                        <span class="px-2 py-1 rounded-full text-xs \${log.status === 'SENT' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">
                                            \${log.status}
                                        </span>
                                    </td>
                                </tr>
                            \`).join('');
                            document.getElementById('logs-body').innerHTML = logsHtml;
                        });
                    }
                    
                    setInterval(updateDashboard, 2000);
                    updateDashboard();
                    
                    async function logout() {
                        if(confirm('Are you sure?')) {
                            // Implement logout endpoint if needed
                            alert('Please stop the server to reset session currently.');
                        }
                    }
                </script>
            </body>
            </html>
        `)
        return
    }

    // 2. KIRIM.CHAT COMPATIBLE API
    // POST /api/messages
    if (req.url === '/api/messages' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body)
                // Kirim.chat often uses 'phone_number' and 'message'
                const phone = payload.phone_number || payload.phone || payload.to
                const text = payload.message || payload.text
                
                if (!phone || !text) throw new Error('Missing phone_number or message')
                
                if (!sock || connectionStatus !== 'connected') throw new Error('WhatsApp Disconnected')
                
                const jid = formatJid(phone)
                await sock.sendMessage(jid, { text: text })
                
                logMessage('API', phone, 'SENT', text)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    status: true,
                    message: 'Message sent successfully',
                    data: { id: 'msg_' + Date.now(), status: 'sent' }
                }))
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: false, error: error.message }))
            }
        })
        return
    }

    // 3. HEALTH & STATUS
    if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
            status: connectionStatus,
            qr: qrCode,
            user: userProfile,
            logs: messageLogs
        }))
        return
    }
    
    // Fallback
    res.writeHead(404)
    res.end('Not Found')
})

server.listen(PORT, () => {
    console.log(`🚀 Gateway running at http://localhost:${PORT}`)
})

startWhatsApp()
