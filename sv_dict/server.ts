// Proxy Bun:
//   - WebSocket  /stt              -> wss://api.x.ai/v1/stt   (com Authorization: Bearer)
//   - HTTP POST  /api/voice/tts    -> https://api.x.ai/v1/tts (API oficial xAI TTS)
//
// Run:    bun run server.ts
// Env:    XAI_API_KEY (ou VITE_XAI_API_KEY) obrigatório.
//         XAI_TTS_URL (opcional, default https://api.x.ai/v1/tts).
//         STT_PROXY_PORT (opcional, default 8787).

const XAI_KEY = process.env.XAI_API_KEY ?? process.env.VITE_XAI_API_KEY;
if (!XAI_KEY) {
  console.error('Missing XAI_API_KEY (or VITE_XAI_API_KEY) in env');
  process.exit(1);
}

const PORT = Number(process.env.STT_PROXY_PORT ?? 8787);
const XAI_TTS_URL = process.env.XAI_TTS_URL ?? 'https://api.x.ai/v1/tts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // ---------- WebSocket STT ----------
    if (url.pathname === '/stt') {
      const search =
        url.search && url.search.length > 1
          ? url.search
          : '?sample_rate=16000&encoding=pcm&interim_results=true&language=pt';

      const ok = server.upgrade(req, {
        data: { upstreamUrl: 'wss://api.x.ai/v1/stt' + search },
      });
      return ok ? undefined : new Response('Upgrade failed', { status: 400 });
    }

    // ---------- TTS (xAI oficial) ----------
    if (url.pathname === '/api/voice/tts') {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (req.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      try {
        const body = (await req.json()) as { text?: string; language?: string; voice_id?: string };
        const text = (body.text ?? '').trim();
        if (!text) {
          return new Response(JSON.stringify({ error: 'text obrigatório' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }

        if (!XAI_TTS_URL) {
          return new Response(
            JSON.stringify({
              error: 'xAI TTS endpoint não configurado',
              hint: 'Defina XAI_TTS_URL para habilitar. Frontend usará Web Speech API como fallback.',
            }),
            {
              status: 501,
              headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            },
          );
        }

        // Encaminha para a API oficial xAI TTS (https://api.x.ai/v1/tts)
        const upstream = await fetch(XAI_TTS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${XAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voice_id: body.voice_id ?? 'ara',
            language: body.language ?? 'pt-BR',
            text_normalization: true,
          }),
        });
        if (!upstream.ok) {
          const txt = await upstream.text();
          return new Response(
            JSON.stringify({ error: 'upstream error', status: upstream.status, body: txt }),
            { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
          );
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') ?? 'audio/mpeg',
            ...CORS_HEADERS,
          },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
  websocket: {
    open(ws) {
      const { upstreamUrl } = ws.data as { upstreamUrl: string };
      console.log('client connected ->', upstreamUrl);

      const upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${XAI_KEY}` },
      } as any);

      (ws as any).upstream = upstream;
      (ws as any).queue = [] as (string | ArrayBuffer)[];

      upstream.addEventListener('open', () => {
        console.log('upstream xAI open');
        const q = (ws as any).queue as (string | ArrayBuffer)[];
        for (const msg of q) upstream.send(msg as any);
        q.length = 0;
      });
      upstream.addEventListener('message', (e: MessageEvent) => {
        ws.send(e.data as any);
      });
      upstream.addEventListener('close', (e: CloseEvent) => {
        console.log('upstream closed', e.code, e.reason);
        ws.close();
      });
      upstream.addEventListener('error', (e) => {
        console.error('upstream error', e);
        try { ws.close(1011, 'upstream error'); } catch { /* ignore */ }
      });
    },
    message(ws, data) {
      const upstream = (ws as any).upstream as WebSocket | undefined;
      if (!upstream) return;
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data as any);
      } else {
        ((ws as any).queue as any[]).push(data);
      }
    },
    close(ws) {
      try { (ws as any).upstream?.close(); } catch { /* ignore */ }
    },
  },
});

console.log(`STT proxy listening on ws://localhost:${PORT}/stt`);
console.log(`TTS endpoint        on http://localhost:${PORT}/api/voice/tts ${XAI_TTS_URL ? '(xAI)' : '(placeholder — fallback Web Speech)'}`);
