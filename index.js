const express = require('express');
const cors = require('cors');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.get('/ping', (req, res) => res.send('OK'));

app.post('/generate', async (req, res) => {
    let { phone, method } = req.body;
    
    if (method === 'pair' && !phone) {
        return res.status(400).json({ error: "Please enter a valid phone number!" });
    }

    if (phone) phone = phone.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, 'sessions', (phone || 'qr_' + Date.now()));

    if (fs.existsSync(sessionDir)) {
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch(e) {}
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 15000,
        });

        sock.ev.on('creds.update', saveCreds);

        if (method === 'pair') {
            // Tumia Promise.race kuweka timeout ya sekunde 12 isizunguke milele
            const getCode = new Promise(async (resolve, reject) => {
                try {
                    await delay(2000);
                    if (!sock.authState.creds.registered) {
                        const code = await sock.requestPairingCode(phone);
                        resolve(code);
                    } else {
                        reject("Number already registered!");
                    }
                } catch (err) {
                    reject(err);
                }
            });

            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject("Connection timeout. WhatsApp is taking too long to respond. Try again!"), 12000)
            );

            try {
                const code = await Promise.race([getCode, timeout]);
                return res.json({ code });
            } catch (err) {
                return res.status(500).json({ error: typeof err === 'string' ? err : "Failed to generate Pair Code. Try again." });
            }
        } 
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
                    return res.status(504).json({ error: "QR Code timeout. Please try again." });
                }
            }, 10000);
        }

        // Kutuma Session ID DM
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
                } catch (err) {}
                setTimeout(() => {
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch(e) {}
                }, 10000);
            }
        });

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: "Server error occurred. Please try again." });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
