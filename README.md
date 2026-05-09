# xAI_voice

Prova de Conceito das funcionalidades de STT/TTS (Speech-to-Text/Text-to-Speech) da xAI.

## Projetos

### pypoc_cadastro

PoC em **Python** de preenchimento de cadastro de clínica por voz. Usa a xAI API (Grok `grok-3`) via biblioteca `openai` para extrair campos (nome, endereço, CNPJ) a partir de texto falado. STT/TTS são simulados por `input()`/`print()` — em produção seriam substituídos por Grok STT/TTS real. Requer Python 3.14+ e [uv](https://docs.astral.sh/uv/).

### sv_dict

**Ditado Grok** — app web de ditado por voz em tempo real, construído com **Svelte 5 + Vite + Bun**. Captura áudio do microfone do navegador e envia via WebSocket para a API STT da xAI através de um proxy Bun (`server.ts`), que injeta a API key no lado do servidor. Também expõe endpoint TTS (`/api/voice/tts`) e inclui um motor genérico de formulários por voz (`VoiceFormEngine`) orientado por schema, reutilizável para diferentes cadastros.
