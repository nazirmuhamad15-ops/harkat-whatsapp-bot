# Harkat WhatsApp Bot v2.0

WhatsApp Bot untuk Harkat Furniture menggunakan **Zaileys** - simplified WhatsApp API.

## Features

- 🤖 AI Auto-Reply dengan Google Gemini
- 💬 Rate limiting built-in (20 msg/10 detik)
- 📱 Auto-read, auto-online, auto-reject calls
- 🔌 HTTP API untuk integrasi admin panel

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env dengan DATABASE_URL dan GOOGLE_GENERATIVE_AI_API_KEY

# Run
npm start
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/status` | GET | Connection status & QR |
| `/send` | POST | Send message |
| `/connect` | POST | Reconnect bot |
| `/logout` | POST | Disconnect |

## Environment Variables

```env
DATABASE_URL=postgresql://...
GOOGLE_GENERATIVE_AI_API_KEY=...
PORT=3001
```

## Deploy to Render

1. Connect GitHub repo
2. Set environment variables
3. Build command: `npm install`
4. Start command: `npm start`
