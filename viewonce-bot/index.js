const path = require('node:path');
const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  normalizeMessageContent
} = require('@whiskeysockets/baileys');

const pino = require('pino');

process.umask(0o077);

const authDirectory = path.join(__dirname, 'auth');
let socket;
let reconnectTimer;
let reconnectAttempts = 0;
let stopping = false;

async function protectAuthFiles() {
  const fs = require('node:fs/promises');

  await fs.chmod(authDirectory, 0o700);
  const entries = await fs.readdir(authDirectory, { withFileTypes: true });

  await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map((entry) => fs.chmod(path.join(authDirectory, entry.name), 0o600)));
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;

  const delay = Math.min(1000 * (2 ** reconnectAttempts), 30000);
  reconnectAttempts += 1;
  console.log(`Reconnecting in ${Math.round(delay / 1000)} seconds.`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    startBot(socket?.authState, socket?.saveCreds);
  }, delay);
}

// ---------------------------------------------------------------------------
// View Once handling
// ---------------------------------------------------------------------------

async function handleViewOnce(sock, msg) {
  const raw = msg.message;
  if (!raw) return;

  // normalizeMessageContent unwraps viewOnceMessage / viewOnceMessageV2 /
  // ephemeralMessage / documentWithCaptionMessage wrappers.
  const normalized = normalizeMessageContent(raw);
  if (!normalized) return;

  const imageMsg = normalized.imageMessage;
  const videoMsg = normalized.videoMessage;
  const audioMsg = normalized.audioMessage;

  const isViewOnce =
    imageMsg?.viewOnce === true ||
    videoMsg?.viewOnce === true ||
    audioMsg?.viewOnce === true;

  if (!isViewOnce) return;

  const chatId = msg.key.remoteJid;
  if (!chatId) return;

  try {
    // downloadMediaMessage must receive the ORIGINAL msg object, not the
    // normalized content, so it can resolve the correct media key.
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage
      }
    );

    if (!buffer || buffer.length === 0) {
      console.error('View Once download returned empty buffer.');
      return;
    }

    if (imageMsg) {
      await sock.sendMessage(chatId, {
        image: buffer,
        caption: imageMsg.caption || '🔓 View Once image'
      }, { quoted: msg });
    } else if (videoMsg) {
      await sock.sendMessage(chatId, {
        video: buffer,
        caption: videoMsg.caption || '🔓 View Once video'
      }, { quoted: msg });
    } else if (audioMsg) {
      await sock.sendMessage(chatId, {
        audio: buffer,
        mimetype: audioMsg.mimetype || 'audio/mp4'
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('View Once download failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

function startBot(state, saveCreds) {
  if (stopping) return;

  try {
    const browserIdentity = state.creds.registered
      ? Browsers.androidPhone('Chrome')
      : Browsers.macOS('Safari');

    socket = makeWASocket({
      auth: state,
      browser: browserIdentity,
      printQRInTerminal: process.stdout.isTTY,
      logger: pino({ level: 'silent' })
    });

    socket.authState = state;
    socket.saveCreds = saveCreds;

    socket.ev.on('creds.update', () => {
      saveCreds().catch((error) => {
        console.error('Failed to save authentication credentials:', error);
      });
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          await handleViewOnce(socket, msg);
        } catch (error) {
          console.error('Failed to process message:', error.message);
        }
      }
    });

    socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('Bot connected.');
        return;
      }

      if (connection !== 'close') return;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('Bot logged out. Re-link the account to continue.');
        return;
      }

      console.error(`Bot connection closed (status: ${statusCode ?? 'unknown'}).`);
      scheduleReconnect();
    });
  } catch (error) {
    console.error('Failed to start the bot:', error);
    scheduleReconnect();
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  console.log(`Received ${signal}; shutting down.`);
  socket?.end(new Error(`Received ${signal}`));
}

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
  await protectAuthFiles();
  startBot(state, saveCreds);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Failed to initialize the bot:', error);
  process.exitCode = 1;
});