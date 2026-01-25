import 'dotenv/config';
import express from 'express';
import { Client } from 'zaileys';
import { db } from './db';
import { users, conversations, messages } from './schema';
import { eq, desc } from 'drizzle-orm';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3001;
const USE_AI = true;

// --- EXPRESS SERVER for API endpoints ---
const app = express();
app.use(express.json());

// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- ZAILEYS CLIENT ---
const wa = new Client({
    session: 'harkat-bot',
    authType: 'qr',
    prefix: '!',
    showLogs: true,
    fancyLogs: true,
    autoRead: true,
    autoOnline: true,
    autoPresence: true,
    autoRejectCall: true,
    ignoreMe: true,
    limiter: { maxMessages: 20, durationMs: 10_000 },
    sticker: {
        authorName: 'Harkat Furniture',
        packageName: 'HarkatBot',
        quality: 80,
    },
});

// --- HELPER: FORMAT PHONE ---
function formatPhone(phone: string): string {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    if (!p.startsWith('62')) p = '62' + p;
    return p;
}

// --- STATE ---
let currentQR: string | null = null;
let currentUser: { id: string; name: string } | null = null;
let connectionStatus: 'offline' | 'disconnected' | 'scanning' | 'connected' = 'offline';

// --- CONNECTION EVENTS ---
// --- CONNECTION EVENTS ---
wa.on('connection', (ctx) => {
    const { status, qr } = ctx;
    console.log(`📱 Connection status: ${status}`);
    
    // Update Connection Status
    if (status === 'open') {
        connectionStatus = 'connected';
        currentQR = null;
    } else if (status === 'close') {
        connectionStatus = 'disconnected';
    } else if (status === 'connecting') {
        connectionStatus = 'offline'; // Attempting to connect
    }

    // Handle QR Code
    if (qr) {
        console.log('📱 QR Code received');
        currentQR = qr;
        connectionStatus = 'scanning';
    }
});

// --- MESSAGES EVENT ---
wa.on('messages', async (ctx) => {
    try {
        // Skip bot messages and status broadcasts
        if (ctx.isBot || ctx.isStory) return;

        const phone = ctx.senderId.split('@')[0];
        const content = ctx.text || '';
        const msgType = ctx.chatType || 'text';

        // Check for Commands (Prefix: !)
        if (ctx.command) {
            const cmd = ctx.command.toLowerCase();
            
            if (cmd === 'menu' || cmd === 'help') {
                await wa.send(ctx.roomId, `
🤖 *Harkat Furniture Bot* 🤖

Halo kak! Ada yang bisa dibantu?
Ketik pesan langsung untuk ngobrol dengan AI kami.

Atau gunakan perintah:
✅ *!menu* - Tampilkan pesan ini
✅ *!status* - Cek status order (WIP)
✅ *!admin* - Panggil admin (WIP)
✅ *!ping* - Cek bot aktif

_Bot powered by Gemini AI_
                `.trim());
                return;
            }

            if (cmd === 'ping') {
                await wa.send(ctx.roomId, 'Pong! 🏓 Bot is active.');
                return;
            }
            // Add more commands here
        }

        console.log(`📩 Received from ${phone}: ${content.slice(0, 50)}...`);

        // 1. Find or Create User
        let user = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.phone, phone)
        });

        if (!user) {
            console.log('Creating new user/contact...');
            const [newUser] = await db.insert(users).values({
                name: ctx.senderName || 'WhatsApp User',
                phone: phone,
                email: `${phone}@whatsapp.user`,
                password: 'hashed_placeholder',
                role: 'CUSTOMER',
                isActive: true,
                emailVerified: true
            }).returning();
            user = newUser;
        }

        // 2. Find or Create Conversation
        let conversation = await db.query.conversations.findFirst({
            where: eq(conversations.userId, user.id)
        });

        if (!conversation) {
            const [newConv] = await db.insert(conversations).values({
                userId: user.id,
                status: 'ai_active',
                unreadCount: 0,
            }).returning();
            conversation = newConv;
        }

        // 3. Save Message to DB
        await db.insert(messages).values({
            conversationId: conversation.id,
            sender: 'USER',
            type: msgType,
            content: content,
            mediaUrl: null,
        });

        // 4. Update Conversation Stats
        await db.update(conversations)
            .set({
                lastMessageAt: new Date(),
                unreadCount: (conversation.unreadCount || 0) + 1
            })
            .where(eq(conversations.id, conversation.id));

        // 5. AI AUTO-REPLY (if status is 'ai_active')
        if (conversation.status === 'ai_active' && USE_AI && content) {
            await processAIResponse(ctx.roomId, conversation.id, content);
        }

    } catch (err) {
        console.error('Error processing incoming message:', err);
    }
});

// --- AI LOGIC ---
async function processAIResponse(roomId: string, conversationId: string, userMessage: string) {
    try {
        // Fetch Context (Last 5 messages)
        const history = await db.query.messages.findMany({
            where: eq(messages.conversationId, conversationId),
            orderBy: desc(messages.createdAt),
            limit: 5
        });

        // Construct Prompt
        const contextStr = history.reverse().map(m => `${m.sender}: ${m.content}`).join('\n');

        const systemPrompt = `
You are Harkat Furniture's AI Assistant. 
You are helpful, polite, and professional.
Answer briefly. If you don't know, ask the user to wait for a human agent.
Context:
${contextStr}
        `;

        const result = await model.generateContent(systemPrompt);
        const aiResponse = result.response.text();

        console.log(`🤖 AI Reply: ${aiResponse}`);

        // Send to WhatsApp using zaileys
        await wa.send(roomId, aiResponse);

        // Save AI Reply to DB
        await db.insert(messages).values({
            conversationId: conversationId,
            sender: 'SYSTEM',
            content: aiResponse,
            type: 'text'
        });

    } catch (err) {
        console.error('AI Processing Error:', err);
    }
}

// --- HTTP API ENDPOINTS ---

// GET /status - For admin panel
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: currentQR,
        user: currentUser
    });
});

// GET / - Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Harkat WhatsApp Bot',
        version: '2.0.0',
        connection: connectionStatus,
        hint: connectionStatus === 'connected' ? 'All good!' : 'Go to /qr to scan QR Code'
    });
});

// GET /qr - Render QR Code
app.get('/qr', async (req, res) => {
    if (connectionStatus === 'connected') {
        return res.send('<html><body><h1>✅ Bot is already connected!</h1></body></html>');
    }
    if (!currentQR) {
        return res.send('<html><body><h1>⏳ QR Code not ready yet. Please Wait/Refresh...</h1></body></html>');
    }
    
    try {
        const QRCode = require('qrcode');
        const url = await QRCode.toDataURL(currentQR);
        res.send(`
            <html>
                <body style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                    <div style="text-align:center;">
                        <h1>Scan QR Code</h1>
                        <img src="${url}" alt="QR Code" style="width:300px; height:300px; border:1px solid #ddd;"/>
                        <p>Status: ${connectionStatus}</p>
                        <p>Refresh if expired</p>
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR image');
    }
});

// POST /send - Send message
app.post('/send', async (req, res) => {
    try {
        const { jid, message, phone } = req.body;
        const recipient = jid || (phone ? `${formatPhone(phone)}@s.whatsapp.net` : null);
        
        if (!recipient || !message) {
            return res.status(400).json({ error: 'Missing jid/phone or message' });
        }

        await wa.send(recipient, message);
        res.json({ success: true });
    } catch (err) {
        console.error('Send error:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// POST /connect - Reconnect
app.post('/connect', (req, res) => {
    res.json({ success: true, message: 'Bot is running, scan QR if needed' });
});

// POST /logout - Disconnect
app.post('/logout', async (req, res) => {
    try {
        // Zaileys doesn't have direct logout, but we can handle it
        res.json({ success: true, message: 'Logout request received' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 HTTP Server running on port ${PORT}`);
    console.log(`📱 WhatsApp Bot starting...`);
    // wa.initialize() is handled automatically by new Client()
    // Just waiting for events now
});

// Export for use
export { wa };
