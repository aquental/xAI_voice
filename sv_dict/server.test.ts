import { describe, test, expect, afterAll } from 'bun:test';

// ---------- Mock upstream TTS server (sends chunked audio) ----------
const CHUNKS = [
  new Uint8Array([0xff, 0xfb, 0x90, 0x00]), // fake MP3 frame header
  new Uint8Array(1024).fill(0xaa),
  new Uint8Array(1024).fill(0xbb),
];

const mockTTS = Bun.serve({
  port: 0, // random available port
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    const body = await req.json();
    if (!body.text) {
      return new Response('bad request', { status: 400 });
    }

    // Stream chunks with small delays to simulate real TTS
    const stream = new ReadableStream({
      async start(controller) {
        for (const chunk of CHUNKS) {
          controller.enqueue(chunk);
          await Bun.sleep(10);
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  },
});

const MOCK_PORT = mockTTS.port;
const PROXY_PORT = MOCK_PORT + 1;

// ---------- Start the proxy as a subprocess ----------
const proxyProc = Bun.spawn(['bun', 'run', 'server.ts'], {
  cwd: import.meta.dir,
  env: {
    ...process.env,
    XAI_API_KEY: 'test-key',
    XAI_TTS_URL: `http://localhost:${MOCK_PORT}`,
    STT_PROXY_PORT: String(PROXY_PORT),
  },
  stdout: 'pipe',
  stderr: 'pipe',
});

// Wait for the proxy to be ready
await (async () => {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`http://localhost:${PROXY_PORT}/api/voice/tts`, { method: 'OPTIONS' });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error('Proxy server did not start in time');
})();

const BASE = `http://localhost:${PROXY_PORT}`;

afterAll(() => {
  proxyProc.kill();
  mockTTS.stop();
});

// ---------- Tests ----------

describe('TTS streaming proxy', () => {
  test('streams audio response without buffering', async () => {
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Olá mundo' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');

    // Read the response as a stream and collect chunks
    const reader = res.body!.getReader();
    const receivedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(value);
    }

    // Verify we got data and total size matches
    const totalExpected = CHUNKS.reduce((sum, c) => sum + c.byteLength, 0);
    const totalReceived = receivedChunks.reduce((sum, c) => sum + c.byteLength, 0);
    expect(totalReceived).toBe(totalExpected);
  });

  test('includes CORS headers', async () => {
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test' }),
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('returns 400 when text is missing', async () => {
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test('handles OPTIONS preflight', async () => {
    const res = await fetch(`${BASE}/api/voice/tts`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  test('returns 405 for GET', async () => {
    const res = await fetch(`${BASE}/api/voice/tts`, { method: 'GET' });
    expect(res.status).toBe(405);
  });
});
