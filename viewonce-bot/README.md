# View Once Bot

## Credentials

The WhatsApp session is stored in the local `auth/` directory. Keep this directory private: do not commit it, share it, or include it in backups accessible to others. The bot restricts its permissions to the current user.

Pair the account only from a trusted interactive terminal. Do not record or share the QR code displayed during pairing. QR output is disabled when the process is not attached to an interactive terminal.

To revoke the linked session, use WhatsApp's **Settings → Linked devices**, select this device, and log it out. After revoking it, remove the local `auth/` directory before pairing again.

The bot does not process or re-send incoming messages.
