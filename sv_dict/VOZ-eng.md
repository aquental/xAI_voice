# VOZ — Documento de implementação (engenharia)

Este documento descreve o que foi implementado a partir de `VOZ.prd` e como o
código foi mesclado com o projeto existente (`sv_dict` — demo de ditado em
Vite + Svelte 5 com proxy Bun para xAI STT).

> **Escopo deste repositório.** O `VOZ.prd` foi escrito assumindo o app PSI
> em SvelteKit. Este repositório é um demo standalone em Vite + Svelte 5.
> A implementação foi montada de modo que os módulos do motor (`src/lib/voice/**`)
> sejam **portáveis para SvelteKit sem mudanças** — só os componentes Svelte
> (e o `server.ts`, que vira rotas `+server.ts` no SvelteKit) precisarão ser
> reposicionados.

---

## 1. Decisões tomadas (perguntadas ao usuário antes de implementar)

| Tema | Opção escolhida | Consequência |
|---|---|---|
| **TTS provider** | xAI TTS placeholder | Endpoint `/api/voice/tts` existe no proxy, mas devolve 501 enquanto `XAI_TTS_URL` não estiver configurado. O frontend cai automaticamente em Web Speech API para que o autoplay (CA09) continue funcionando. |
| **STT mode** | Reusar WebSocket existente (streaming) | Mantém `ws://localhost:8787/stt`. Idioma alterado para `pt`. Cada etapa do formulário inicia/encerra sua própria sessão STT — interim transcripts continuam sendo mostrados em tempo real. |
| **Integração** | Adicionar como segunda view | Mantém o ditado livre original (preservado em `DictationView.svelte`) e adiciona uma nova rota `Cadastro por voz` que monta `CompanyRegistrationPage`. |

---

## 2. Arquitetura implementada

```
src/
├─ App.svelte                                # Switcher entre as duas views
├─ main.js                                   # Bootstrap Svelte 5 (mount)
└─ lib/
   ├─ components/
   │  ├─ CompanyRegistrationPage.svelte      # Página consumidora do motor
   │  ├─ VoiceFormAssistant.svelte           # Componente UI do assistente
   │  └─ DictationView.svelte                # Ditado livre (movido de App.svelte)
   └─ voice/
      ├─ types.ts                            # Tipos do motor (provider-agnósticos)
      ├─ engine/
      │  └─ VoiceFormEngine.ts               # Máquina de estados orientada por schema
      ├─ providers/
      │  ├─ XaiSttProvider.ts                # WS streaming → proxy Bun
      │  └─ XaiTtsProvider.ts                # POST /api/voice/tts + fallback Web Speech
      ├─ parser/
      │  ├─ VoiceFormParser.ts               # parseStepAnswer, parseYesNo, looksLikeOffTopicQuestion
      │  ├─ normalizers.ts                   # cnpj_basic, phone_br, email_spoken_pt_br
      │  └─ validators.ts                    # cnpj_length_only
      └─ schemas/
         └─ companyRegistrationVoiceSchema.ts
server.ts                                    # Proxy Bun: WS /stt + HTTP /api/voice/tts
public/
└─ pcm-processor.js                          # AudioWorklet (preservado)
```

Fluxo (alinhado com o PRD):

```
CompanyRegistrationPage.svelte
  └─ <VoiceFormAssistant schema={companyRegistrationVoiceSchema} ... />
       └─ VoiceFormEngine
            ├─ XaiSttProvider  ──► ws://…/stt  ──► wss://api.x.ai/v1/stt
            ├─ XaiTtsProvider  ──► POST /api/voice/tts (xAI placeholder)
            │                       └─ fallback: speechSynthesis
            └─ VoiceFormParser
```

---

## 3. Mapeamento PRD → arquivos

| Item do PRD | Onde foi implementado |
|---|---|
| Camada genérica `VoiceFormEngine` | `src/lib/voice/engine/VoiceFormEngine.ts` |
| `SpeechToTextProvider` interface + `TranscriptionResult` | `src/lib/voice/types.ts` |
| `VoiceFormSchema<T>`, `VoiceFormStep<T>` | `src/lib/voice/types.ts` |
| Schema do cadastro de empresa | `src/lib/voice/schemas/companyRegistrationVoiceSchema.ts` |
| Função `normalizeCnpj` (formato 00.000.000/0000-00) | `src/lib/voice/parser/normalizers.ts` |
| `phone_br`, `email_spoken_pt_br` | `src/lib/voice/parser/normalizers.ts` |
| `cnpj_length_only` (sem DV) | `src/lib/voice/parser/validators.ts` |
| Endpoint `POST /api/voice/stt` | **Substituído** pelo WS `/stt` já existente (decisão registrada acima). |
| Endpoint `POST /api/voice/tts` | `server.ts` (placeholder, controlado por `XAI_TTS_URL`) |
| Reprodução automática de TTS após gesto inicial | `VoiceFormAssistant.svelte::start()` cria/resume AudioContext antes de iniciar o motor; engine emite `autoplay-blocked` se algum `audio.play()` falhar. |
| Botão "Tocar áudio" como fallback | `VoiceFormAssistant.svelte` mostra banner amarelo com botão quando `blockedPlay` é setado. |
| Bloqueio de chatbot (CA08) | `VoiceFormParser.looksLikeOffTopicQuestion()` + estado `speaking_redirect` no engine. |
| Confirmação obrigatória por etapa | Estado `awaiting_confirmation` + `parseYesNo()`. Botões manuais Sim/Não disponíveis. |
| Schema como fonte de verdade | Engine só consulta `schema.steps[i]`; nada hard-coded. |
| Mensagens de intro/conclusão | `schema.introMessage` e `schema.completionMessage` no companyRegistrationVoiceSchema. |

---

## 4. Máquina de estados (`VoiceFormEngine`)

Estados públicos (em `EngineState`):

```
idle
 → speaking_intro
   → speaking_prompt
     → listening
       → processing
         ├─ (offtopic_question) → speaking_redirect → listening
         ├─ (invalid)          → speaking_redirect → listening
         ├─ (confirm needed)   → speaking_confirmation → awaiting_confirmation
         │                                                ├─ "sim"     → next step
         │                                                ├─ "não"     → speaking_redirect → speaking_prompt
         │                                                └─ "?" + N×  → speaking_redirect → awaiting_confirmation
         └─ (no confirm)       → next step
… → speaking_completion → completed
```

Métodos públicos:

- `start()` — toca intro e entra no primeiro passo. Deve ser chamado em resposta a um clique do usuário (gesto de autoplay).
- `finishListening()` — fim de fala (botão "Terminei de falar"); pede transcript final ao STT, processa.
- `confirmManually(yes|no)` — fallback de UI para confirmação por clique.
- `setFieldManually(field, value)` — fallback de digitação manual (CA do PRD/CHAT).
- `cancel()` — derruba STT e marca `cancelled`.

Eventos emitidos (`EngineEvent`):
`state` · `partial` · `final` · `field` · `error` · `completed` · `autoplay-blocked`.

---

## 5. Providers

### `XaiSttProvider`

- **WebSocket streaming** — reusa `public/pcm-processor.js` (AudioWorklet), abre conexão com `ws://localhost:8787/stt?sample_rate=...&encoding=pcm&interim_results=true&language=pt`.
- `start({ language, onPartial })` — abre o WS, captura mic, emite `onPartial(text)` para cada `transcript.partial` ou `transcript.done` com `is_final=false`.
- `stop()` — para captura de áudio, envia `{type:'audio.done'}`, espera `transcript.done` final (timeout de 4 s).
- `cancel()` — encerra tudo sem aguardar.

### `XaiTtsProvider`

- Tenta primeiro `POST <endpoint>` (default `http://localhost:8787/api/voice/tts`).
- Se receber não-200 ou não-`audio/*`, marca `xaiAvailable=false` e usa `speechSynthesis` para esta e próximas chamadas (até reload).
- Sempre devolve um `HTMLAudioElement`. No fallback, `audio.play()` dispara `speechSynthesis.speak()` e simula eventos `play`/`ended`.

---

## 6. Parser

### `parseStepAnswer(step, raw)`

Saídas:
- `{ kind: 'value', answer }` — valor pronto para gravar.
- `{ kind: 'invalid', answer, validation }` — validador rejeitou (ex: CNPJ ≠ 14 dígitos).
- `{ kind: 'offtopic_question' }` — sinaliza CA08, engine dispara redirect.

### Heurística "off-topic question"

Conservadora — só dispara quando:
- não há `@` nem dígitos no texto **e**
- começa com pronome interrogativo (`qual`, `como`, `por que`, `onde`, `quando`, `quem`, …) **ou** termina com `?`.

A condição "sem dígito/@" evita falso-positivo em respostas legítimas tipo "Qual? CNPJ é 12345678901234" — improvável, mas seguro.

### `parseYesNo`

Reconhece: `sim/isso/correto/certo/exato/exatamente/confirmo/positivo/ok/tá certo/tudo certo` (yes); `não/errado/incorreto/negativo/repete/repetir/de novo` (no). Retorna `unknown` para o caso ambíguo — engine reapresenta a pergunta.

---

## 7. Servidor (`server.ts`)

Mudanças (sem quebrar o que já existia):

- Mantido WS `/stt` exatamente como antes (idioma default mudado para `pt`).
- Adicionado **HTTP** `POST /api/voice/tts`:
  - `OPTIONS` → 204 com headers CORS (frontend Vite roda em porta diferente).
  - Sem `text` → 400.
  - Sem `XAI_TTS_URL` configurado → **501** + JSON `{ error, hint }` (placeholder; frontend cai em Web Speech).
  - Com `XAI_TTS_URL` definido → encaminha para upstream com `Authorization: Bearer ${XAI_KEY}`, devolve `audio/mpeg`.

Variáveis de ambiente:

| Variável | Onde | Função |
|---|---|---|
| `XAI_API_KEY` ou `VITE_XAI_API_KEY` | `server.ts` | Chave xAI para STT (e TTS quando habilitado). **Nunca exposta ao browser.** |
| `STT_PROXY_PORT` | `server.ts` | Porta do proxy (default 8787). |
| `XAI_TTS_URL` | `server.ts` | Endpoint xAI TTS quando disponível. Sem isso, TTS responde 501 e o frontend usa fallback. |
| `VITE_STT_PROXY_URL` | frontend | URL WS do STT (default `ws://localhost:8787/stt`). |
| `VITE_TTS_ENDPOINT` | frontend | URL HTTP do TTS (default `http://localhost:8787/api/voice/tts`). |

---

## 8. Como rodar

```bash
# Terminal 1 — proxy Bun
bun run server.ts

# Terminal 2 — Vite
bun run dev
```

A aba "Cadastro por voz" abre por padrão. Clique em **🎤 Preencher com voz** para iniciar — esse clique destrava o autoplay para a sessão. O assistente toca a intro, faz cada pergunta, ouve, normaliza, confirma quando exigido pelo schema e avança até o `completionMessage`. A qualquer momento o usuário pode digitar nos campos (todos editáveis) ou cancelar.

A aba "Ditado livre" preserva o app original.

---

## 9. Critérios de aceite — status

| CA | Item | Status |
|---|---|---|
| **CA07** | Motor reutilizável | ✅ `VoiceFormEngine<T>` aceita qualquer `VoiceFormSchema<T>`; o cadastro de empresa é apenas o primeiro consumidor. |
| **CA08** | Bloqueio de chatbot | ✅ Pergunta detectada → `speaking_redirect` com `'Neste momento estou ajudando com o cadastro. ' + step.prompt`. |
| **CA09** | Autoplay | ✅ AudioContext destravado no clique inicial; áudios gerados após esse ponto chamam `.play()` direto. Em caso de falha, evento `autoplay-blocked` mostra botão "🔊 Tocar áudio". |

---

## 10. Limitações conhecidas

1. **xAI TTS não existe oficialmente ainda.** O endpoint `/api/voice/tts` foi mantido como placeholder; em produção, definir `XAI_TTS_URL` na hora que xAI publicar. Até lá, o assistente fala com Web Speech API (qualidade depende do SO e da voz pt-BR instalada).
2. **CNPJ falado.** O xAI STT geralmente já transcreve dígitos como `1234567890`, mas se vier por extenso ("doze, trezentos…"), o normalizador atual só converte palavras-dígito unitárias (`um, dois, três, …`). Para uma cobertura robusta de CNPJ falado em pt-BR seria necessário um parser de português numérico — fora do escopo deste piloto (PRD: "validação formal de CNPJ fica fora do piloto").
3. **`finishListening` é manual.** O usuário precisa clicar "Terminei de falar". VAD automático não está implementado — decisão deliberada para evitar falso encerramento durante pausas naturais. xAI emite `transcript.done` final por inatividade, mas dependemos do clique para avançar a máquina de estados.
4. **Não há persistência.** `manualSave()` em `CompanyRegistrationPage` só mostra o JSON. A integração com o "Existing Company Registration Service" (citada no PRD) acontece quando isto for portado para o app PSI real.
5. **Não há testes automatizados.** O projeto não tem suíte de testes; smoke test feito manualmente (`vite build` passa, `server.ts` sobe, endpoint TTS devolve as 3 respostas esperadas).

---

## 11. Mapa de portabilidade para o PSI (SvelteKit)

Quando este código for movido para o app PSI:

| Aqui | No PSI (SvelteKit) |
|---|---|
| `src/lib/voice/**` | `src/lib/voice/**` (idêntico — sem dependências do entrypoint Vite). |
| `src/lib/components/VoiceFormAssistant.svelte` | `src/lib/components/voice/VoiceFormAssistant.svelte`. |
| `src/lib/components/CompanyRegistrationPage.svelte` | `src/routes/empresa/cadastro/+page.svelte` (ou rota equivalente). |
| `server.ts` (Bun) WS `/stt` | Já é um proxy independente — **mantenha rodando como serviço** (Bun ou Node) ou implemente como handler `+server.ts` se SvelteKit for usado em ambiente que suporta WS. |
| `server.ts` HTTP `/api/voice/tts` | `src/routes/api/voice/tts/+server.ts` (handler SvelteKit POST). |
| `import.meta.env.VITE_*` | `$env/static/public` (as `PUBLIC_STT_PROXY_URL`, etc). |

---

## 12. Arquivos novos

```
src/App.svelte                                      (modificado: virou switcher)
src/lib/components/CompanyRegistrationPage.svelte   (novo)
src/lib/components/DictationView.svelte             (novo: extraído do App.svelte original)
src/lib/components/VoiceFormAssistant.svelte        (novo)
src/lib/voice/engine/VoiceFormEngine.ts             (novo)
src/lib/voice/parser/VoiceFormParser.ts             (novo)
src/lib/voice/parser/normalizers.ts                 (novo)
src/lib/voice/parser/validators.ts                  (novo)
src/lib/voice/providers/XaiSttProvider.ts           (novo)
src/lib/voice/providers/XaiTtsProvider.ts           (novo)
src/lib/voice/schemas/companyRegistrationVoiceSchema.ts (novo)
src/lib/voice/types.ts                              (novo)
server.ts                                           (modificado: adicionado /api/voice/tts; idioma WS → pt)
VOZ-eng.md                                          (este documento)
```

Inalterados: `public/pcm-processor.js`, `index.html`, `vite.config.js`,
`svelte.config.js`, `package.json`, `app.css`, `main.js`.
