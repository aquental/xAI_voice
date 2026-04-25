<script lang="ts">
	import { onMount } from 'svelte';

	let transcript = '';
	let isListening = false;
	let finalTranscript = '';
	let interimTranscript = '';

	// API Key da xAI (carregada do .env)
	const apiKey = import.meta.env.VITE_XAI_API_KEY;

	let ws: WebSocket | null = null;

	onMount(() => {
		if (!apiKey) {
			console.warn('⚠️  API Key da xAI não configurada no .env');
		} else {
      console.log('✅ API Key da xAI carregada');
    } 
	});

	async function toggleListening() {
		if (isListening) {
			ws?.close();
			isListening = false;
			return;
		}

		finalTranscript = '';
		transcript = '';
		isListening = true;

		// Conexão com WebSocket da xAI (nova API de voz)
		ws = new WebSocket('wss://api.x.ai/v1/stt');

		ws.onopen = () => {
			console.log('✅ Conectado ao Grok STT');
			// Envia autenticação
			ws?.send(JSON.stringify({
				type: "auth",
				api_key: apiKey
			}));
		};

		ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			
			if (data.type === 'transcript') {
				if (data.is_final) {
					finalTranscript += data.text + ' ';
				} else {
					interimTranscript = data.text;
				}
				transcript = finalTranscript + interimTranscript;
			}
		};

		ws.onerror = (err) => {
			console.error('Erro no WebSocket xAI:', err);
			isListening = false;
		};

		ws.onclose = () => {
			isListening = false;
		};

		// Aqui você deve capturar áudio do microfone e enviar chunks
		// (código completo de captura de áudio abaixo)
		startAudioCapture();
	}

	async function startAudioCapture() {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const audioContext = new AudioContext();
		const source = audioContext.createMediaStreamSource(stream);
		const processor = audioContext.createScriptProcessor(4096, 1, 1);

		processor.onaudioprocess = (e) => {
			const inputData = e.inputBuffer.getChannelData(0);
			// Converte para PCM e envia para xAI
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(inputData.buffer);
			}
		};

		source.connect(processor);
		processor.connect(audioContext.destination);
	}

	function copyTranscript() {
		navigator.clipboard.writeText(finalTranscript.trim());
		alert('✅ Transcrição copiada!');
	}

	function clearTranscript() {
		finalTranscript = '';
		transcript = '';
	}
</script>

<!-- O resto do HTML/visual continua igual ao anterior -->
<main class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-8 font-sans">
	<div class="max-w-3xl w-full">
		<div class="flex items-center justify-between mb-8">
			<h1 class="text-4xl font-light tracking-tight">Ditado Grok</h1>
			<button
				on:click={toggleListening}
				class="px-6 py-3 rounded-2xl font-medium transition-all flex items-center gap-2 {isListening 
					? 'bg-red-600 hover:bg-red-700' 
					: 'bg-white text-zinc-900 hover:bg-zinc-100'}"
			>
				{isListening ? '⏹️ Parar' : '🎤 Começar (xAI)'}
			</button>
		</div>

		<div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 min-h-[420px] shadow-2xl">
			{#if transcript}
				<p class="text-2xl leading-relaxed text-zinc-100 whitespace-pre-wrap">
					{finalTranscript}
					<span class="text-zinc-400">{interimTranscript}</span>
				</p>
			{:else}
				<div class="flex flex-col items-center justify-center h-full text-center text-zinc-500">
					<div class="text-7xl mb-6 opacity-30">🎤</div>
					<p class="text-xl">Fale naturalmente.<br>Usando xAI STT</p>
				</div>
			{/if}
		</div>

		<div class="flex gap-4 mt-6">
			<button on:click={copyTranscript} disabled={!finalTranscript} class="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-medium">
				📋 Copiar texto
			</button>
			<button on:click={clearTranscript} disabled={!finalTranscript} class="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-medium">
				🗑️ Limpar
			</button>
		</div>
	</div>
</main>
