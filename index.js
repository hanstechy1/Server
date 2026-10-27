const express = require('express');
const cors = require('cors');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Health check endpoint kuzuia Render isilale
app.get('/ping', (req, res) => res.send('OK'));

app.post('/generate', async (req, res) => {
    let { phone, method } = req.body;
    
    if (method === 'pair' && !phone) {
        return res.status(400).json({ error: "Please enter a valid phone number!" });
    }

    if (phone) phone = phone.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, 'sessions', (phone || 'qr_' + Date.now()));

    // Futa session zilizopita ikiwa zipo ili kuzuia kugoma
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'fatal' }),
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        // Kutoa Pair Code haraka
        if (method === 'pair') {
            await delay(1500);
            if (!sock.authState.creds.registered) {
                try {
                    const code = await sock.requestPairingCode(phone);
                    return res.json({ code });
                } catch (err) {
                    return res.status(500).json({ error: "Error generating Pair Code. Try again!" });
                }
            } else {
                return res.json({ message: "Number already registered!" });
            }
        } 
        
        // Kutoa QR Code
        else if (method === 'qr') {
            let hasResponded = false;

            sock.ev.on('connection.update', (update) => {
                const { qr } = update;
                if (qr && !hasResponded && !res.headersSent) {
                    hasResponded = true;
                    return res.json({ qr });
                }
            });

            setTimeout(() => {
                if (!hasResponded && !res.headersSent) {
                    return res.status(508).json({ error: "QR Code timeout. Please try clicking again!" });
                }
            }, 25000);
        }

        // Send Session ID to DM upon successful login
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        const sessionId = Buffer.from(credsData).toString('base64');

                        const message = `✅ *Connected Successfully!*\n\nHere is your Session ID:\n\n\`\`\`Session_${sessionId}\`\`\`\n\n*Warning:* Do not share this ID with anyone!`;
                        
                        await sock.sendMessage(sock.user.id, { text: message });
                    }
                } catch (err) {
                    console.error("Failed to send session ID:", err);
                }

                setTimeout(() => {
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                }, 10000);
            }
        });

    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to process request." });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Fast Server running on port ${PORT}`));
