// STT proxy: browser <-> this server <-> wss://api.x.ai/v1/stt
// Run with:  bun run server.ts
// Requires XAI_API_KEY (or VITE_XAI_API_KEY) in the environment / .env.

const XAI_KEY = process.env.XAI_API_KEY ?? process.env.VITE_XAI_API_KEY;
if (!XAI_KEY) {
  console.error('Missing XAI_API_KEY (or VITE_XAI_API_KEY) in env');
  process.exit(1);
}

const PORT = Number(process.env.STT_PROXY_PORT ?? 8787);

Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== '/stt') return new Response('Not found', { status: 404 });

    const search = url.search && url.search.length > 1
      ? url.search
      : '?sample_rate=16000&encoding=pcm&interim_results=true&language=en';

    const ok = server.upgrade(req, {
      data: { upstreamUrl: 'wss://api.x.ai/v1/stt' + search },
    });
    return ok ? undefined : new Response('Upgrade failed', { status: 400 });
  },
  websocket: {
    open(ws) {
      const { upstreamUrl } = ws.data as { upstreamUrl: string };
      console.log('client connected ->', upstreamUrl);

      // Bun's WebSocket constructor accepts headers via the second arg options.
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
        try { ws.close(1011, 'upstream error'); } catch {}
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
      try { (ws as any).upstream?.close(); } catch {}
    },
  },
});

console.log(`STT proxy listening on ws://localhost:${PORT}/stt`);
