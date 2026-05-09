# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ditado Grok** — a browser-based voice dictation app that streams microphone audio to xAI's Speech-to-Text (STT) WebSocket API and renders real-time transcripts. The app is in Portuguese (Brazilian).

## Architecture

Two processes must run simultaneously:

1. **Bun proxy server** (`server.ts`) — a WebSocket-to-WebSocket bridge at `ws://localhost:8787/stt`. The browser cannot call xAI directly because the API key must stay server-side. This proxy injects the `Authorization: Bearer` header when connecting to `wss://api.x.ai/v1/stt`.

2. **Vite dev server** — serves the Svelte 5 frontend.

### Audio pipeline (browser)

```
Microphone → getUserMedia → AudioContext → MediaStreamSource
  → AudioWorkletNode (pcm-processor.js) → postMessage(Int16Array buffer)
  → WebSocket → Bun proxy → xAI STT WebSocket
```

- `public/pcm-processor.js` runs inside an `AudioWorkletGlobalScope` (separate thread). It converts float32 samples to signed 16-bit little-endian PCM, which is what `encoding=pcm` means in the xAI STT API.
- The worklet is loaded via `audioContext.audioWorklet.addModule('/pcm-processor.js')` and must remain in `public/` so Vite serves it at root.
- The source node is intentionally **not** connected to `audioContext.destination` to avoid microphone feedback.

### Message flow

- Browser sends binary `ArrayBuffer` chunks (raw PCM) over WebSocket.
- Browser sends `{ type: 'audio.done' }` JSON to signal end of speech.
- xAI responds with `transcript.partial` / `transcript.done` messages; `is_final: true` promotes interim text to final.

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `XAI_API_KEY` or `VITE_XAI_API_KEY` | `server.ts` | xAI API key — **never expose to the browser** |
| `VITE_STT_PROXY_URL` | `src/App.svelte` | Override proxy URL (default: `ws://localhost:8787/stt`) |
| `STT_PROXY_PORT` | `server.ts` | Override proxy port (default: `8787`) |

## Commands

### Development (run both in parallel)

```bash
# Terminal 1 — Bun proxy (requires XAI_API_KEY in env or .env)
bun run server.ts

# Terminal 2 — Vite frontend
bun run dev
```

### Build & preview

```bash
bun run build
bun run preview
```

Package manager is **Bun**; do not use npm or pnpm.
