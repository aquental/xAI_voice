// Tipos centrais do motor de formulários por voz.
// Reutilizáveis por qualquer schema (cadastro de empresa é apenas o primeiro).

export type Language = 'pt-BR';

export type TranscriptionResult = {
	text: string;
	confidence?: number;
	language: Language;
	provider: 'xai';
};

export type SpeechToTextProvider = {
	/** Streaming: começa a captura e devolve eventos de transcript parcial/final. */
	start(opts: SttStartOptions): Promise<void>;
	/** Sinaliza fim de fala e aguarda transcript final. */
	stop(): Promise<TranscriptionResult>;
	/** Cancela sem aguardar transcript. */
	cancel(): void;
};

export type SttStartOptions = {
	language: Language;
	onPartial?: (text: string) => void;
};

export type TextToSpeechProvider = {
	/** Gera áudio para o texto e devolve um HTMLAudioElement já carregado. */
	synthesize(text: string, opts?: { language?: Language; voice_id?: string }): Promise<HTMLAudioElement>;
};

export type VoiceFormStep<T> = {
	id: string;
	field: keyof T | string;
	prompt: string;
	required: boolean;
	confirmationRequired: boolean;
	parserHint?: string;
	normalizer?: NormalizerName;
	validator?: ValidatorName;
};

export type VoiceFormSchema<T> = {
	formType: string;
	language: Language;
	introMessage: string;
	completionMessage: string;
	steps: VoiceFormStep<T>[];
};

export type NormalizerName =
	| 'cnpj_basic'
	| 'phone_br'
	| 'email_spoken_pt_br';

export type ValidatorName = 'cnpj_length_only';

export type ValidationResult =
	| { ok: true }
	| { ok: false; reason: string };

/** Valor obtido a partir de uma transcrição, antes de ir para o estado. */
export type ParsedAnswer = {
	/** Texto normalizado pronto para gravação no campo. */
	value: string;
	/** Texto que será lido na confirmação (formato amigável). */
	display: string;
	/** Texto bruto vindo do STT (para depuração). */
	raw: string;
};

/** Estados públicos da máquina de estados. */
export type EngineState =
	| 'idle'
	| 'speaking_intro'
	| 'speaking_prompt'
	| 'listening'
	| 'processing'
	| 'speaking_confirmation'
	| 'awaiting_confirmation'
	| 'speaking_redirect'
	| 'speaking_completion'
	| 'completed'
	| 'cancelled'
	| 'error';

export type EngineEvent =
	| { type: 'state'; state: EngineState }
	| { type: 'field'; field: string; value: string }
	| { type: 'partial'; text: string }
	| { type: 'final'; text: string }
	| { type: 'error'; message: string }
	| { type: 'completed'; data: Record<string, string> }
	| { type: 'autoplay-blocked'; play: () => Promise<void> };
