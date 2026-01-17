// Standalone WhatsApp Bot Service
// Run this separately with: npx tsx scripts/whatsapp-bot.ts

/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-require-imports */

import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    downloadMediaMessage
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import * as http from 'http'
import * as path from 'path'
import * as fs from 'fs'
// @ts-ignore
import qrTerminal from 'qrcode-terminal'
import { db } from './db'
import { users, conversations, messages } from './schema'
import { eq, and } from 'drizzle-orm'
import PQueue from 'p-queue'

// Minimal PQueue polyfill if import fails (ESM vs CJS issues often happen in standalone TS)
// But since we use tsx, it might work. If not, we fall back to simple async.

const msgQueue = new PQueue({ concurrency: 1, interval: 500, intervalCap: 1 });

let sock: any = null
let qrCode: string | null = null
let connectionStatus = 'disconnected'

// Helper to sanitize phone
const sanitizePhone = (id: string) => id.split('@')[0].replace(/\D/g, '')

async function saveIncomingMessage(msg: any) {
    if (!msg.key.remoteJid || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    const phone = sanitizePhone(remoteJid);
    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '[media]';
    const msgType = msg.message?.imageMessage ? 'image' : 'text';

    try {
        // 1. Find or Create User
        let user = await db.query.users.findFirst({
            where: eq(users.phone, phone)
        });

        if (!user) {
            console.log(`👤 New contact identified: ${phone}`);
            const [newUser] = await db.insert(users).values({
                phone: phone,
                name: msg.pushName || `Customer ${phone}`,
                role: 'CUSTOMER',
                isActive: true
            }).returning();
            user = newUser;
        }

        // 2. Find or Create Conversation
        let conversation = await db.query.conversations.findFirst({
            where: eq(conversations.userId, user!.id)
        });

        if (!conversation) {
            const [newConv] = await db.insert(conversations).values({
                userId: user!.id,
                status: 'ai_active',
                unreadCount: 0
            }).returning();
            conversation = newConv;
        }

        // 3. Handle Media (Optional/Simplified)
        let mediaUrl = null;
        if (msgType === 'image') {
            // Placeholder: In real app, download stream -> upload to R2 -> get URL
            // const buffer = await downloadMediaMessage(msg, 'buffer', { logger: pino() });
            mediaUrl = 'https://placehold.co/600x400?text=Image+Received'; 
        }

        // 4. Save Message
        await db.insert(messages).values({
            conversationId: conversation!.id,
            sender: 'USER',
            type: msgType,
            content: content,
            mediaUrl: mediaUrl,
        });

        // 5. Update Conversation Metadata
        await db.update(conversations)
            .set({ 
                lastMessageAt: new Date(),
                unreadCount: (conversation!.unreadCount || 0) + 1 
            })
            .where(eq(conversations.id, conversation!.id));

        console.log(`✅ Saved message from ${user!.name} (${phone}): ${content.substring(0, 20)}...`);

    } catch (err) {
        console.error('❌ Failed to save message:', err);
    }
}

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
        printQRInTerminal: false, // We handle it manually
        browser: ['Harkat Furniture Bot', 'Chrome', '120.0.0'],
    })

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCode = qr
            connectionStatus = 'scanning'
            console.log('🔲 New QR Code generated!')
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
    
    // INCOMING MESSAGE HANDLER
    sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
        if (type === 'notify') {
            for (const msg of messages) {
                if (!msg.key.fromMe) {
                    await msgQueue.add(() => saveIncomingMessage(msg));
                }
            }
        }
    })
}

// SHARED INBOX API SERVER
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    
    // Status Endpoint
    if (req.url === '/status') {
        res.end(JSON.stringify({
            status: connectionStatus,
            qr: qrCode
        }))
        return;
    } 
    
    // QR Display Endpoint
    if (req.url === '/qr') {
        res.setHeader('Content-Type', 'text/html')
        res.end(qrCode ? 
            `<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0"><div style="background:white;padding:20px;border-radius:10px;text-align:center"><h2>Scan WhatsApp</h2><div id="qr"></div><script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script><script>QRCode.toCanvas(document.getElementById('qr'), '${qrCode}', {width:300})</script><p>Refreshes every 30s</p><script>setTimeout(()=>location.reload(),30000)</script></div></body></html>` : 
            `<html><body><h1>${connectionStatus === 'connected' ? '✅ Connected' : '⏳ Initializing...'}</h1><script>setTimeout(()=>location.reload(),2000)</script></body></html>`
        )
        return;
    }

    // SEND MESSAGE (Admin Reply)
    if (req.url?.startsWith('/send') && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
            try {
                if (connectionStatus !== 'connected') {
                    throw new Error('WhatsApp not connected');
                }

                const { phone, message } = JSON.parse(body)
                if (!phone || !message) throw new Error('Existing phone and message required');

                // 1. Send via WhatsApp
                const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
                await msgQueue.add(() => sock.sendMessage(jid, { text: message }));

                // 2. Update DB (Synced with Dashboard)
                const sanitized = sanitizePhone(phone);
                
                // Find User & Conv
                const user = await db.query.users.findFirst({ where: eq(users.phone, sanitized) });
                if (user) {
                    const conv = await db.query.conversations.findFirst({ where: eq(conversations.userId, user.id) });
                    if (conv) {
                        // Switch to HUMAN mode
                        await db.update(conversations)
                            .set({ status: 'human_manual', lastMessageAt: new Date() })
                            .where(eq(conversations.id, conv.id));

                        // Insert outgoing message
                        await db.insert(messages).values({
                            conversationId: conv.id,
                            sender: 'ADMIN',
                            type: 'text',
                            content: message
                        });
                    }
                }

                console.log(`📤 Reply sent to ${phone}: ${message}`);
                res.end(JSON.stringify({ success: true }))

            } catch (e: any) {
                console.error('❌ Send Error:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: e.message }))
            }
        })
        return;
    }

    res.end(JSON.stringify({ service: 'Harkat WA Bot', version: '2.0.0' }))
})

const PORT = process.env.PORT || 8001
server.listen(PORT, () => {
    console.log(`🚀 WA Shared Inbox running on port ${PORT}`)
    startWhatsApp()
})
