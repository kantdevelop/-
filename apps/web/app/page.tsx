'use client';

import { useEffect, useState } from 'react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export default function Page() {
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setError('');
    try {
      const res = await fetch(`${BACKEND}/api/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone.replace(/\D/g, '') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'request failed');
      setUserId(data.userId);
      setPairingCode(data.pairingCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    }
  }

  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/status/${userId}`);
        const data = await res.json();
        if (data.linked) {
          setLinked(true);
        }
      } catch {
        // keep polling while the backend is unreachable
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [userId]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '48rem', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>View Once Bot</h1>
      <p>Link your WhatsApp number to start.</p>

      <label>
        Phone number (no +):
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="4155552671"
          style={{ marginLeft: '0.5rem', padding: '0.4rem 0.6rem' }}
        />
      </label>
      <button
        onClick={handleGenerate}
        style={{ marginLeft: '0.5rem', padding: '0.5rem 0.8rem' }}
      >
        Generate Pairing Code
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {pairingCode && (
        <p>
          Pairing code: <strong>{pairingCode}</strong>
        </p>
      )}
      {linked && (
        <p style={{ color: 'green' }}>
          Bot is now active. Send a View Once message to this number.
        </p>
      )}
    </main>
  );
}
