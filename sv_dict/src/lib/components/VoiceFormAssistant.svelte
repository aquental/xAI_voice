<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { EngineEvent, EngineState, VoiceFormSchema } from '../voice/types';
	import { VoiceFormEngine } from '../voice/engine/VoiceFormEngine';
	import { XaiSttProvider } from '../voice/providers/XaiSttProvider';
	import { XaiTtsProvider } from '../voice/providers/XaiTtsProvider';

	type Props = {
		schema: VoiceFormSchema<any>;
		formData: Record<string, string>;
		onUpdate: (field: string, value: string) => void;
		onComplete?: (data: Record<string, string>) => void;
	};

	let { schema, formData, onUpdate, onComplete }: Props = $props();

	const STT_PROXY_URL =
		(import.meta.env.VITE_STT_PROXY_URL as string) ?? 'ws://localhost:8787/stt';
	const TTS_ENDPOINT =
		(import.meta.env.VITE_TTS_ENDPOINT as string) ?? 'http://localhost:8787/api/voice/tts';
	const TTS_CONFIG_ENDPOINT = TTS_ENDPOINT.replace(/\/tts(\?.*)?$/, '/config');

	let engineState: EngineState = $state('idle');
	let currentPrompt = $state('');
	let currentField = $state('');
	let interimTranscript = $state('');
	let lastFinalText = $state('');
	let blockedPlay: null | (() => Promise<void>) = $state(null);
	let errorMessage = $state('');
	let active = $state(false);

	let engine: VoiceFormEngine<any> | null = null;
	let unsubscribe: (() => void) | null = null;

	const SILENCE_TIMEOUT_MS = 3000;
	let silenceTimer: ReturnType<typeof setTimeout> | null = null;

	function clearSilenceTimer() {
		if (silenceTimer) {
			clearTimeout(silenceTimer);
			silenceTimer = null;
		}
	}

	function scheduleSilenceTimer() {
		clearSilenceTimer();
		const state = engineState;
		if ((state !== 'listening' && state !== 'awaiting_confirmation') || !engine) return;
		silenceTimer = setTimeout(() => {
			silenceTimer = null;
			const s = engineState;
			if (s === 'awaiting_confirmation') {
				engine?.finishListening().catch((e) => {
					console.error('[VoiceFormAssistant] finishListening (confirmação silêncio) falhou:', e);
				});
				return;
			}
			if (s !== 'listening') return;
			const field = currentField;
			if (!field) return;
			const typedValue = (formData[field] ?? '').trim();
			if (typedValue) {
				engine?.submitTypedAnswer(typedValue).catch((e) => {
					console.error('[VoiceFormAssistant] submitTypedAnswer falhou:', e);
				});
			} else if (interimTranscript.trim()) {
				engine?.finishListening().catch((e) => {
					console.error('[VoiceFormAssistant] finishListening (silêncio) falhou:', e);
				});
			}
		}, SILENCE_TIMEOUT_MS);
	}

	async function fetchForceXai(): Promise<boolean> {
		try {
			const res = await fetch(TTS_CONFIG_ENDPOINT);
			if (!res.ok) return false;
			const cfg = (await res.json()) as { forceXai?: boolean };
			return Boolean(cfg.forceXai);
		} catch (e) {
			console.warn('[VoiceFormAssistant] não foi possível obter config TTS:', e);
			return false;
		}
	}

	function buildEngine(forceXai: boolean): VoiceFormEngine<any> {
		const stt = new XaiSttProvider(STT_PROXY_URL);
		const tts = new XaiTtsProvider(TTS_ENDPOINT, 'ara', forceXai);
		const e = new VoiceFormEngine(schema, { stt, tts });
		unsubscribe = e.subscribe((ev: EngineEvent) => {
			switch (ev.type) {
				case 'state':
					engineState = ev.state;
					if (ev.state === 'speaking_prompt') {
						const step = e.currentStep;
						currentPrompt = step?.prompt ?? '';
						currentField = (step?.field as string) ?? '';
						interimTranscript = '';
					}
					if (ev.state === 'listening') {
						const step = e.currentStep;
						currentField = (step?.field as string) ?? '';
						scheduleSilenceTimer();
					} else if (ev.state === 'awaiting_confirmation') {
						scheduleSilenceTimer();
					} else {
						clearSilenceTimer();
					}
					if (ev.state === 'completed') {
						onComplete?.(e.formData);
						active = false;
					}
					break;
				case 'partial':
					// Só reinicia o timer quando o texto muda de verdade.
					// Eventos repetidos/vazios do xAI (flushes) chegam com o mesmo
					// texto e não devem resetar a contagem de silêncio.
					if ((engineState === 'listening' || engineState === 'awaiting_confirmation') && ev.text !== interimTranscript) scheduleSilenceTimer();
					interimTranscript = ev.text;
					break;
				case 'final':
					lastFinalText = ev.text;
					interimTranscript = '';
					break;
				case 'field':
					onUpdate(ev.field, ev.value);
					break;
				case 'autoplay-blocked':
					blockedPlay = ev.play;
					break;
				case 'error':
					errorMessage = ev.message;
					break;
				case 'completed':
					onComplete?.(ev.data);
					break;
			}
		});
		return e;
	}

	export async function start(): Promise<void> {
		if (active) return;
		errorMessage = '';
		blockedPlay = null;
		// O clique que dispara start() destrava o autoplay para a sessão.
		try {
			// Pré-aquece um AudioContext para destravar políticas de autoplay.
			const ctx = new AudioContext();
			await ctx.resume();
			ctx.close().catch(() => { /* ignore */ });
		} catch { /* ignore */ }

		const forceXai = await fetchForceXai();
		engine = buildEngine(forceXai);
		active = true;
		try {
			await engine.start();
		} catch (e: any) {
			errorMessage = e?.message ?? String(e);
			active = false;
		}
	}

	export function cancel(): void {
		clearSilenceTimer();
		engine?.cancel();
		active = false;
		engineState = 'cancelled';
	}

	async function finishListening(): Promise<void> {
		await engine?.finishListening();
	}

	export async function skipField(): Promise<void> {
		await engine?.skipField();
	}

	async function confirmYes(): Promise<void> { await engine?.confirmManually(true); }
	async function confirmNo(): Promise<void> { await engine?.confirmManually(false); }
	async function playBlocked(): Promise<void> {
		const fn = blockedPlay;
		if (fn) {
			blockedPlay = null;
			await fn();
		}
	}

	// Se o usuário digitar no campo do passo atual durante a escuta,
	// reinicia o timer de silêncio — ele só dispara após 3s de inatividade
	// (sem fala parcial e sem digitação nova).
	$effect(() => {
		const field = currentField;
		if (!field) return;
		// Lê o valor para que o $effect rastreie mudanças neste campo.
		const _value = formData[field];
		void _value;
		if (engineState === 'listening') scheduleSilenceTimer();
	});

	onDestroy(() => {
		clearSilenceTimer();
		unsubscribe?.();
		engine?.cancel();
	});

	const isListening = $derived(engineState === 'listening' || engineState === 'awaiting_confirmation');
	const isSpeaking = $derived(
		engineState === 'speaking_intro' ||
		engineState === 'speaking_prompt' ||
		engineState === 'speaking_confirmation' ||
		engineState === 'speaking_redirect' ||
		engineState === 'speaking_completion'
	);
	const isProcessing = $derived(engineState === 'processing');
</script>

<div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-xl">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-xl font-light">Assistente por voz</h2>
		<div class="flex gap-2">
			{#if !active}
				<button
					onclick={start}
					class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
				>
					🎤 Preencher com voz
				</button>
			{:else}
				<button
					onclick={cancel}
					class="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-medium"
				>
					⏹️ Cancelar
				</button>
			{/if}
		</div>
	</div>

	{#if errorMessage}
		<div class="mb-3 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-200 text-sm">
			{errorMessage}
		</div>
	{/if}

	{#if blockedPlay}
		<div class="mb-3 p-3 rounded-lg bg-amber-900/40 border border-amber-700 text-amber-200 text-sm flex items-center justify-between">
			<span>Áudio bloqueado pelo navegador.</span>
			<button onclick={playBlocked} class="px-3 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white">
				🔊 Tocar áudio
			</button>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-3 text-sm">
		<div class="flex items-center gap-2">
			<span class="font-medium text-zinc-400">Estado:</span>
			<span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200">{engineState}</span>
			{#if isSpeaking}<span class="text-blue-400">🔊 falando…</span>{/if}
			{#if isListening}<span class="text-emerald-400 animate-pulse">🎙️ ouvindo…</span>{/if}
			{#if isProcessing}<span class="text-amber-400">⏳ processando…</span>{/if}
		</div>

		{#if currentPrompt}
			<div>
				<span class="font-medium text-zinc-400">Pergunta atual:</span>
				<span class="text-zinc-100">{currentPrompt}</span>
			</div>
		{/if}

		{#if interimTranscript}
			<div>
				<span class="font-medium text-zinc-400">Você está dizendo:</span>
				<span class="text-zinc-300 italic">{interimTranscript}</span>
			</div>
		{/if}

		{#if lastFinalText && !interimTranscript}
			<div>
				<span class="font-medium text-zinc-400">Última transcrição:</span>
				<span class="text-zinc-300">{lastFinalText}</span>
			</div>
		{/if}
	</div>

	{#if isListening}
		<div class="mt-4 flex flex-col gap-2">
			<div class="flex gap-2">
				<button
					onclick={finishListening}
					class="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium"
				>
					✅ Terminei de falar
				</button>
				{#if engineState === 'awaiting_confirmation'}
					<button onclick={confirmYes} class="px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white">Sim</button>
					<button onclick={confirmNo} class="px-4 py-3 rounded-xl bg-red-700 hover:bg-red-800 text-white">Não</button>
				{/if}
			</div>
			{#if engineState === 'listening'}
				<button
					onclick={skipField}
					class="w-full py-2 rounded-xl bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-200 text-sm font-medium border border-zinc-700 hover:border-zinc-500 transition-colors"
					title="Deixa este campo em branco e vai para o próximo"
				>
					⏭️ Pular campo
				</button>
			{/if}
		</div>
	{/if}
</div>
