import type { Language, SpeechToTextProvider, SttStartOptions, TranscriptionResult } from '../types';

/** STT provider que reusa o proxy WebSocket Bun (server.ts) para xAI STT.
 *  Streaming: encaminha chunks PCM mono 16-bit LE via AudioWorklet.
 *  Final: ao chamar stop(), envia { type: 'audio.done' } e aguarda transcript final.
 */
export class XaiSttProvider implements SpeechToTextProvider {
	private proxyUrl: string;
	private ws: WebSocket | null = null;
	private audioContext: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private mediaStream: MediaStream | null = null;
	private finalText = '';
	private interimText = '';
	private language: Language = 'pt-BR';
	private onPartial?: (text: string) => void;
	private finalResolver: ((r: TranscriptionResult) => void) | null = null;
	private finalRejecter: ((e: Error) => void) | null = null;
	private finalTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(proxyUrl: string) {
		this.proxyUrl = proxyUrl;
	}

	async start(opts: SttStartOptions): Promise<void> {
		this.language = opts.language;
		this.onPartial = opts.onPartial;
		this.finalText = '';
		this.interimText = '';

		this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.audioContext = new AudioContext();
		await this.audioContext.audioWorklet.addModule('/pcm-processor.js');
		this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
		this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

		const sampleRate = this.audioContext.sampleRate;
		const params = new URLSearchParams({
			sample_rate: String(sampleRate),
			encoding: 'pcm',
			interim_results: 'true',
			language: this.language === 'pt-BR' ? 'pt' : 'en'
		});
		this.ws = new WebSocket(`${this.proxyUrl}?${params.toString()}`);
		this.ws.binaryType = 'arraybuffer';

		const wsOpened = new Promise<void>((resolve, reject) => {
			if (!this.ws) return reject(new Error('WS não inicializado'));
			this.ws.addEventListener('open', () => resolve(), { once: true });
			this.ws.addEventListener('error', () => reject(new Error('Erro ao abrir WS STT')), { once: true });
		});

		this.workletNode.port.onmessage = (event) => {
			const pcmBuffer = event.data as ArrayBuffer;
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(pcmBuffer);
			}
		};

		this.ws.onmessage = (event) => {
			let data: any;
			try { data = JSON.parse(event.data); } catch { return; }
			if (data.type === 'transcript.partial' || data.type === 'transcript.done') {
				if (data.is_final) {
					this.finalText += (data.text ?? '') + ' ';
					this.interimText = '';
				} else {
					this.interimText = data.text ?? '';
				}
				this.onPartial?.(this.finalText + this.interimText);

				if (data.type === 'transcript.done' && data.is_final && this.finalResolver) {
					this.resolveFinal();
				}
			} else if (data.type === 'error') {
				this.finalRejecter?.(new Error(data.message ?? 'Erro STT'));
				this.finalRejecter = null;
				this.finalResolver = null;
			}
		};

		this.sourceNode.connect(this.workletNode);
		// Não conectamos ao destination para evitar feedback do microfone.

		await wsOpened;
	}

	stop(): Promise<TranscriptionResult> {
		return new Promise<TranscriptionResult>((resolve, reject) => {
			this.finalResolver = resolve;
			this.finalRejecter = reject;

			// Pára de capturar áudio mas mantém o WS aberto para receber o final.
			this.teardownAudio();

			try {
				this.ws?.send(JSON.stringify({ type: 'audio.done' }));
			} catch (e) {
				reject(e as Error);
				return;
			}

			// Timeout de segurança: se o servidor não enviar transcript.done em 4s,
			// devolvemos o que temos.
			this.finalTimer = setTimeout(() => {
				if (this.finalResolver) this.resolveFinal();
			}, 4000);
		});
	}

	cancel(): void {
		this.teardownAudio();
		try { this.ws?.close(); } catch { /* ignore */ }
		this.ws = null;
		this.finalResolver = null;
		this.finalRejecter = null;
		if (this.finalTimer) {
			clearTimeout(this.finalTimer);
			this.finalTimer = null;
		}
	}

	private resolveFinal(): void {
		if (this.finalTimer) {
			clearTimeout(this.finalTimer);
			this.finalTimer = null;
		}
		const text = (this.finalText + this.interimText).trim();
		const resolver = this.finalResolver;
		this.finalResolver = null;
		this.finalRejecter = null;
		try { this.ws?.close(); } catch { /* ignore */ }
		this.ws = null;
		resolver?.({ text, language: this.language, provider: 'xai' });
	}

	private teardownAudio(): void {
		try { this.workletNode?.port.close(); this.workletNode?.disconnect(); } catch { /* ignore */ }
		try { this.sourceNode?.disconnect(); } catch { /* ignore */ }
		this.mediaStream?.getTracks().forEach((t) => t.stop());
		this.audioContext?.close().catch(() => { /* ignore */ });
		this.workletNode = null;
		this.sourceNode = null;
		this.mediaStream = null;
		this.audioContext = null;
	}
}
