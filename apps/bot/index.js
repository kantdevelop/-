const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const pino = require('pino');
const {
  default: makeWASocket,
  Browsers,
  useMultiFileAuthState,
  downloadMediaMessage,
  normalizeMessageContent
} = require('@outlaw1/baileys');
const { prisma } = require('@viewonce/db');

const logger = pino({ level: 'info' });
const app = express();
app.use(express.json());

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const authDir = path.join(dataDir, 'auth');

// Map<userId, { sock, linked, sessionId }>
const sessions = new Map();

function newPairingCode() {
  return String(crypto.randomInt(10000000, 99999999));
}

async function getOrCreateUser(phoneNumber) {
  const jid = phoneNumber + '@s.whatsapp.net';
  let user = await prisma.user.findFirst({ where: { phoneNumber: jid } });
  if (!user) user = await prisma.user.create({ data: { phoneNumber: jid } });
  return user;
}

async function startBot(userId) {
  const entry = sessions.get(userId);
  if (entry?.sock) {
    entry.sock.ev.removeAllListeners();
    try { entry.sock.end?.(); } catch {}
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, rejectOnNotFound: true });
  const { state, saveCreds } = await useMultiFileAuthState(path.join(authDir, userId));

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.android('Chrome'),
    logger: pino({ level: 'silent' })
  });

  const stateEntry = { sock, linked: false, sessionId: entry?.sessionId, reconnectTimer: undefined };
  sessions.set(userId, stateEntry);

  sock.ev.on('creds.update', () => saveCreds().catch((err) => logger.warn(err, 'saveCreds failed')));

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      handleViewOnce(sock, userId, msg).catch((err) => logger.error(err, 'handleViewOnce failed'));
    }
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      stateEntry.linked = true;
      if (stateEntry.sessionId) {
        prisma.session.update({
          where: { id: stateEntry.sessionId },
          data: { status: 'linked', updatedAt: new Date() }
        }).catch(() => {});
      }
      logger.info({ userId }, 'bot connected');
      return;
    }

    if (connection !== 'close') return;
    logger.info({ userId, status: lastDisconnect?.error?.output?.statusCode }, 'bot disconnected, reconnecting in 10s');
    if (stateEntry.reconnectTimer) clearTimeout(stateEntry.reconnectTimer);
    stateEntry.reconnectTimer = setTimeout(() => {
      stateEntry.reconnectTimer = undefined;
      void startBot(userId);
    }, 10000);
  });

  return sock;
}

async function handleViewOnce(sock, userId, msg) {
  const normalized = normalizeMessageContent(msg.message);
  if (!normalized) return;

  const imageMsg = normalized.imageMessage;
  const videoMsg = normalized.videoMessage;
  const audioMsg = normalized.audioMessage;

  const isViewOnce =
    imageMsg?.viewOnce === true ||
    videoMsg?.viewOnce === true ||
    audioMsg?.viewOnce === true;
  if (!isViewOnce) return;

  const targetChatId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const sender = msg.key.participant || msg.key.remoteJid;

  const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
    logger: pino({ level: 'silent' }),
    reuploadRequest: sock.updateMediaMessage
  });
  if (!buffer || buffer.length === 0) throw new Error('empty media buffer');

  if (imageMsg) {
    await sock.sendMessage(targetChatId, { image: buffer, caption: `🔓 View Once image from: ${sender}` });
  } else if (videoMsg) {
    await sock.sendMessage(targetChatId, { video: buffer, caption: `🔓 View Once video from: ${sender}` });
  } else if (audioMsg) {
    await sock.sendMessage(targetChatId, { audio: buffer, mimetype: audioMsg.mimetype || 'audio/mp4' });
  }

  logger.info({ userId, sender }, 'intercepted view once');
}

app.post('/api/link', async (req, res) => {
  try {
    const { phoneNumber } = req.body ?? {};
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' });

    const user = await getOrCreateUser(phoneNumber.replace(/\D/g, '').slice(-15));
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionPath: path.join(authDir, user.id),
        status: 'pending',
        pairingCode: newPairingCode()
      }
    });

    sessions.set(user.id, { ...sessions.get(user.id), sessionId: session.id, linked: false });
    void startBot(user.id);

    res.json({ userId: user.id, pairingCode: session.pairingCode });
  } catch (err) {
    logger.error(err, 'link failed');
    res.status(500).json({ error: 'link failed' });
  }
});

app.get('/api/status/:userId', async (req, res) => {
  const linked = sessions.get(req.params.userId)?.linked === true;
  res.json({ linked });
});

app.listen(process.env.PORT || 3000, () => {
  logger.info(`bot listening on ${process.env.PORT || 3000}`);
});
