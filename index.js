const express = require('express');
const cors = require('cors');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Kuunganisha frontend (public folder)
app.use(express.static(path.join(__dirname, 'public')));

app.post('/generate', async (req, res) => {
    let { phone, method } = req.body;
    
    if (method === 'pair' && !phone) {
        return res.status(400).json({ error: "Tafadhali weka namba ya simu!" });
    }

    if (phone) phone = phone.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, 'sessions', phone || 'qr_session_' + Date.now());

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        // Kusikiliza muunganisho ukifanikiwa ili kutuma Session ID DM
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000); // Subiri kidogo creds zikae vizuri
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        const sessionId = Buffer.from(credsData).toString('base64');

                        const message = `✅ *Hongera! Umeunganishwa kwa mafanikio.*\n\nHii hapa chini ni Session ID yako:\n\n\`\`\`Session_${sessionId}\`\`\`\n\n*Tahadhari:* Usishiriki Session ID hii na mtu yeyote!`;
                        
                        await sock.sendMessage(sock.user.id, { text: message });
                        console.log("Session ID imetumwa kwenye DM ya mteja!");
                    }
                } catch (err) {
                    console.error("Hitilafu katika kutuma Session ID:", err);
                }

                // Futa mafaili ya session baada ya dakika chache kulinda server
                setTimeout(() => {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }, 15000);
            }
        });

        if (method === 'pair') {
            if (!sock.authState.creds.registered) {
                await delay(2500);
                const code = await sock.requestPairingCode(phone);
                return res.json({ code });
            } else {
                return res.json({ message: "Namba hii tayari imeshaunganishwa!" });
            }
        } else if (method === 'qr') {
            sock.ev.on('connection.update', (update) => {
                const { qr } = update;
                if (qr && !res.headersSent) {
                    return res.json({ qr });
                }
            });
            // Kama QR haikutoka kwa haraka
            setTimeout(() => {
                if (!res.headersSent) res.status(500).json({ error: "Muda umeisha, jaribu tena." });
            }, 10000);
        }

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: "Imeshindikana kutengeneza code." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
