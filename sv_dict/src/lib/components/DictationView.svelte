<script lang="ts">
	// Ditado livre — comportamento original do app preservado como segunda view.
	import { onMount } from 'svelte';

	let transcript = $state('');
	let isListening = $state(false);
	let finalTranscript = $state('');
	let interimTranscript = $state('');

	const PROXY_URL =
		(import.meta.env.VITE_STT_PROXY_URL as string) ?? 'ws://localhost:8787/stt';

	let ws: WebSocket | null = null;
	let audioContext: AudioContext | null = null;
	let workletNode: AudioWorkletNode | null = null;
	let sourceNode: MediaStreamAudioSourceNode | null = null;
	let mediaStream: MediaStream | null = null;

	onMount(() => {
		console.log('STT proxy:', PROXY_URL);
	});

	async function toggleListening() {
		if (isListening) {
			stopAudioCapture();
			try { ws?.send(JSON.stringify({ type: 'audio.done' })); } catch { /* ignore */ }
			ws?.close();
			isListening = false;
			return;
		}

		finalTranscript = '';
		transcript = '';
		isListening = true;

		await startAudioCapture();
		const sampleRate = audioContext?.sampleRate ?? 16000;

		const params = new URLSearchParams({
			sample_rate: String(sampleRate),
			encoding: 'pcm',
			interim_results: 'true',
			language: 'pt'
		});
		ws = new WebSocket(`${PROXY_URL}?${params.toString()}`);
		ws.binaryType = 'arraybuffer';

		ws.onopen = () => console.log('✅ Conectado ao proxy STT');
		ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			if (data.type === 'transcript.partial' || data.type === 'transcript.done') {
				if (data.is_final) {
					finalTranscript += (data.text ?? '') + ' ';
					interimTranscript = '';
				} else {
					interimTranscript = data.text ?? '';
				}
				transcript = finalTranscript + interimTranscript;
			} else if (data.type === 'error') {
				console.error('STT error:', data.message);
			}
		};
		ws.onerror = (err) => {
			console.error('Erro no WebSocket STT:', err);
			stopAudioCapture();
			isListening = false;
		};
		ws.onclose = () => {
			stopAudioCapture();
			isListening = false;
		};
	}

	async function startAudioCapture() {
		mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		audioContext = new AudioContext();
		await audioContext.audioWorklet.addModule('/pcm-processor.js');
		sourceNode = audioContext.createMediaStreamSource(mediaStream);
		workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
		workletNode.port.onmessage = (event) => {
			const pcmBuffer = event.data as ArrayBuffer;
			if (ws?.readyState === WebSocket.OPEN) ws.send(pcmBuffer);
		};
		sourceNode.connect(workletNode);
	}

	function stopAudioCapture() {
		try { workletNode?.port.close(); workletNode?.disconnect(); } catch { /* ignore */ }
		try { sourceNode?.disconnect(); } catch { /* ignore */ }
		mediaStream?.getTracks().forEach((t) => t.stop());
		audioContext?.close().catch(() => { /* ignore */ });
		workletNode = null;
		sourceNode = null;
		mediaStream = null;
		audioContext = null;
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

<div class="max-w-3xl w-full">
	<div class="flex items-center justify-between mb-8">
		<h1 class="text-4xl font-light tracking-tight">Ditado Grok</h1>
		<button
			onclick={toggleListening}
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
		<button onclick={copyTranscript} disabled={!finalTranscript} class="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-medium">
			📋 Copiar texto
		</button>
		<button onclick={clearTranscript} disabled={!finalTranscript} class="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-medium">
			🗑️ Limpar
		</button>
	</div>
</div>
