import type { Language, TextToSpeechProvider } from '../types';

/** TTS provider que usa a API oficial xAI TTS (https://api.x.ai/v1/tts)
 *  via proxy Bun em /api/voice/tts. Por padrão faz fallback para Web Speech API
 *  caso o proxy esteja indisponível, mas com `forceXai = true` propaga o erro
 *  e nunca cai para o fallback (usado quando XAI_TTS_URL está configurada no .env).
 *
 *  Vozes disponíveis: eve (energética), ara (calorosa), rex (confiante),
 *  sal (equilibrada), leo (autoritativa).
 */
export class XaiTtsProvider implements TextToSpeechProvider {
	private endpoint: string;
	private voiceId: string;
	private forceXai: boolean;
	private xaiAvailable: boolean | null = null;

	constructor(endpoint: string, voiceId: string = 'ara', forceXai: boolean = false) {
		this.endpoint = endpoint;
		this.voiceId = voiceId;
		this.forceXai = forceXai;
	}

	async synthesize(
		text: string,
		opts?: { language?: Language; voice_id?: string }
	): Promise<HTMLAudioElement> {
		const language = opts?.language ?? 'pt-BR';
		const voice_id = opts?.voice_id ?? this.voiceId;

		if (this.forceXai) {
			// XAI_TTS_URL configurada no servidor: xAI é obrigatório, sem fallback.
			const audio = await this.fromXai(text, language, voice_id);
			this.xaiAvailable = true;
			return audio;
		}

		if (this.xaiAvailable !== false) {
			try {
				const audio = await this.fromXai(text, language, voice_id);
				this.xaiAvailable = true;
				return audio;
			} catch (e) {
				this.xaiAvailable = false;
				console.warn('[TTS] xAI indisponível, usando Web Speech API:', e);
			}
		}

		return this.fromWebSpeech(text, language);
	}

	private async fromXai(text: string, language: Language, voice_id: string): Promise<HTMLAudioElement> {
		const res = await fetch(this.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, language, voice_id })
		});
		if (!res.ok) {
			throw new Error(`xAI TTS HTTP ${res.status}`);
		}
		const blob = await res.blob();
		if (!blob.type.startsWith('audio/')) {
			throw new Error(`xAI TTS retornou tipo inesperado: ${blob.type}`);
		}
		const url = URL.createObjectURL(blob);
		const audio = new Audio(url);
		audio.preload = 'auto';
		return audio;
	}

	/** Fallback: Web Speech API. Encapsula em um HTMLAudioElement-like
	 *  para manter a API uniforme. Usamos um Audio dummy mais um shim que
	 *  dispara play() via speechSynthesis.
	 */
	private fromWebSpeech(text: string, language: Language): HTMLAudioElement {
		const audio = new Audio();
		// Não há áudio real de antemão; usamos um shim em torno do método play.
		const originalPlay = audio.play.bind(audio);
		(audio as any).play = (): Promise<void> => {
			return new Promise<void>((resolve, reject) => {
				try {
					if (!('speechSynthesis' in window)) {
						reject(new Error('speechSynthesis indisponível'));
						return;
					}
					const utter = new SpeechSynthesisUtterance(text);
					utter.lang = language;
					utter.rate = 1.0;
					utter.pitch = 1.0;
					utter.onend = () => {
						audio.dispatchEvent(new Event('ended'));
						resolve();
					};
					utter.onerror = (ev) => {
						const err = new Error('speechSynthesis error: ' + ev.error);
						audio.dispatchEvent(new Event('error'));
						reject(err);
					};
					// Cancela qualquer fala pendente antes de iniciar
					window.speechSynthesis.cancel();
					window.speechSynthesis.speak(utter);
					audio.dispatchEvent(new Event('play'));
				} catch (e) {
					// Em último caso, tenta o método nativo (que deve falhar silenciosamente).
					originalPlay().catch(() => { /* ignore */ });
					reject(e as Error);
				}
			});
		};
		return audio;
	}
}
