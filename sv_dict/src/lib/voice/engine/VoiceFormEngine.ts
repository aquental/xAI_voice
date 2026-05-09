import type {
	EngineEvent,
	EngineState,
	ParsedAnswer,
	SpeechToTextProvider,
	TextToSpeechProvider,
	VoiceFormSchema,
	VoiceFormStep
} from '../types';
import { parseStepAnswer, parseYesNo } from '../parser/VoiceFormParser';

export type EngineDeps = {
	stt: SpeechToTextProvider;
	tts: TextToSpeechProvider;
};

type Listener = (event: EngineEvent) => void;

/** Motor de formulários por voz.
 *  Máquina de estados orientada por schema. Não responde perguntas gerais.
 *  Reusável: troque o schema para outro cadastro e o motor segue funcionando.
 */
export class VoiceFormEngine<T extends Record<string, string>> {
	private schema: VoiceFormSchema<T>;
	private deps: EngineDeps;
	private listeners: Set<Listener> = new Set();

	private state: EngineState = 'idle';
	private stepIndex = 0;
	private data: Partial<Record<keyof T | string, string>> = {};
	private pending: ParsedAnswer | null = null;
	private cancelled = false;

	constructor(schema: VoiceFormSchema<T>, deps: EngineDeps) {
		this.schema = schema;
		this.deps = deps;
	}

	get currentState(): EngineState { return this.state; }
	get currentStep(): VoiceFormStep<T> | null {
		return this.schema.steps[this.stepIndex] ?? null;
	}
	get formData(): Record<string, string> {
		return { ...this.data } as Record<string, string>;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Inicia o motor: toca intro e segue para o primeiro campo.
	 *  Deve ser chamado a partir de um gesto do usuário (clique) para destravar autoplay.
	 */
	async start(): Promise<void> {
		this.cancelled = false;
		this.stepIndex = 0;
		this.data = {};
		this.pending = null;

		await this.setState('speaking_intro');
		await this.speak(this.schema.introMessage);
		await this.runCurrentStep();
	}

	cancel(): void {
		this.cancelled = true;
		try { this.deps.stt.cancel(); } catch { /* ignore */ }
		this.setState('cancelled');
	}

	/** Atualiza um campo manualmente (fallback de digitação). */
	setFieldManually(field: string, value: string): void {
		this.data[field] = value;
		this.emit({ type: 'field', field, value });
	}

	/** Submete um valor digitado pelo usuário como se fosse a resposta falada
	 *  do passo atual: cancela o STT, valida e segue para confirmação/avanço.
	 *  Usado quando a UI detecta digitação no campo do passo atual ou silêncio
	 *  prolongado durante a escuta.
	 */
	async submitTypedAnswer(value: string): Promise<void> {
		if (this.state !== 'listening') return;
		const step = this.currentStep;
		if (!step) return;
		const text = (value ?? '').trim();
		if (!text) return;
		try { this.deps.stt.cancel(); } catch { /* ignore */ }
		await this.setState('processing');
		this.emit({ type: 'final', text });
		await this.handleStepTranscript(text);
	}

	/** Permite que o usuário pule diretamente um passo (útil para edição manual). */
	jumpToStep(stepId: string): void {
		const idx = this.schema.steps.findIndex((s) => s.id === stepId);
		if (idx >= 0) this.stepIndex = idx;
	}

	private async runCurrentStep(): Promise<void> {
		if (this.cancelled) return;
		const step = this.currentStep;
		if (!step) {
			await this.completeForm();
			return;
		}
		await this.setState('speaking_prompt');
		await this.speak(step.prompt);
		if (this.cancelled) return;
		await this.captureAnswer(step);
	}

	private async captureAnswer(step: VoiceFormStep<T>): Promise<void> {
		await this.setState('listening');
		await this.deps.stt.start({
			language: this.schema.language,
			onPartial: (text) => this.emit({ type: 'partial', text })
		});
		// O motor não decide quando parar — espera o componente UI chamar finishListening().
	}

	/** Pula o passo atual sem salvar nenhum valor e avança para o próximo campo. */
	async skipField(): Promise<void> {
		if (this.state !== 'listening' && this.state !== 'awaiting_confirmation') return;
		const step = this.currentStep;
		if (!step) return;
		try { this.deps.stt.cancel(); } catch { /* ignore */ }
		this.data[step.field as string] = '';
		this.emit({ type: 'field', field: step.field as string, value: '' });
		this.pending = null;
		await this.setState('speaking_redirect');
		await this.speak('Certo, pulando este campo. Vou para o próximo.');
		this.advance();
	}

	/** Chamado pela UI quando o usuário sinaliza fim da fala (botão "parar"). */
	async finishListening(): Promise<void> {
		if (this.state !== 'listening' && this.state !== 'awaiting_confirmation') return;
		const wasState = this.state;
		await this.setState('processing');
		const result = await this.deps.stt.stop();
		this.emit({ type: 'final', text: result.text });

		if (wasState === 'listening') {
			await this.handleStepTranscript(result.text);
		} else if (wasState === 'awaiting_confirmation') {
			await this.handleConfirmationTranscript(result.text);
		}
	}

	private async handleStepTranscript(rawText: string): Promise<void> {
		const step = this.currentStep;
		if (!step) return;
		const outcome = parseStepAnswer(step, rawText);

		if (outcome.kind === 'offtopic_question') {
			// CA08: redirecionar para o campo atual.
			await this.setState('speaking_redirect');
			await this.speak(
				'Neste momento estou ajudando com o cadastro. ' + step.prompt
			);
			await this.captureAnswer(step);
			return;
		}

		if (outcome.kind === 'invalid') {
			await this.setState('speaking_redirect');
			await this.speak(
				`Não consegui entender. ${outcome.validation.ok ? '' : (outcome.validation as { ok: false; reason: string }).reason} ${step.prompt}`
			);
			await this.captureAnswer(step);
			return;
		}

		this.pending = outcome.answer;
		this.data[step.field as string] = outcome.answer.value;
		this.emit({ type: 'field', field: step.field as string, value: outcome.answer.value });

		if (step.confirmationRequired) {
			await this.askConfirmation(step, outcome.answer);
		} else {
			this.advance();
		}
	}

	private async askConfirmation(step: VoiceFormStep<T>, ans: ParsedAnswer): Promise<void> {
		await this.setState('speaking_confirmation');
		await this.speak(`Entendi: ${ans.display}. Está correto?`);
		await this.setState('awaiting_confirmation');
		await this.deps.stt.start({
			language: this.schema.language,
			onPartial: (text) => this.emit({ type: 'partial', text })
		});
	}

	private async handleConfirmationTranscript(rawText: string): Promise<void> {
		const verdict = parseYesNo(rawText);
		const step = this.currentStep;
		if (!step) return;

		if (verdict === 'yes') {
			this.advance();
			return;
		}
		if (verdict === 'no') {
			// limpa o valor pendente e re-pergunta o mesmo campo
			this.data[step.field as string] = '';
			this.pending = null;
			this.emit({ type: 'field', field: step.field as string, value: '' });
			await this.setState('speaking_redirect');
			await this.speak('Sem problemas. Vamos repetir.');
			await this.runCurrentStep();
			return;
		}
		// "unknown" -> repete confirmação
		await this.setState('speaking_redirect');
		await this.speak('Por favor responda com sim ou não. ' + (this.pending ? `Confirma ${this.pending.display}?` : ''));
		await this.setState('awaiting_confirmation');
		await this.deps.stt.start({
			language: this.schema.language,
			onPartial: (text) => this.emit({ type: 'partial', text })
		});
	}

	/** Confirmação manual via UI (botões "Sim"/"Não" — fallback). */
	async confirmManually(yes: boolean): Promise<void> {
		if (this.state !== 'awaiting_confirmation') return;
		try { this.deps.stt.cancel(); } catch { /* ignore */ }
		const step = this.currentStep;
		if (!step) return;
		if (yes) {
			this.advance();
		} else {
			this.data[step.field as string] = '';
			this.pending = null;
			this.emit({ type: 'field', field: step.field as string, value: '' });
			await this.setState('speaking_redirect');
			await this.speak('Sem problemas. Vamos repetir.');
			await this.runCurrentStep();
		}
	}

	private advance(): void {
		this.pending = null;
		this.stepIndex += 1;
		// Não use await aqui dentro do .then chain — reentra na próxima iteração.
		this.runCurrentStep().catch((e) => {
			console.error('[VoiceFormEngine] erro:', e);
			this.emit({ type: 'error', message: String(e?.message ?? e) });
			this.setState('error');
		});
	}

	private async completeForm(): Promise<void> {
		await this.setState('speaking_completion');
		await this.speak(this.schema.completionMessage);
		await this.setState('completed');
		this.emit({ type: 'completed', data: this.formData });
	}

	private async speak(text: string): Promise<void> {
		const audio = await this.deps.tts.synthesize(text, { language: this.schema.language });
		try {
			await audio.play();
		} catch (e) {
			// Autoplay bloqueado — emite evento para a UI exibir botão de play.
			this.emit({
				type: 'autoplay-blocked',
				play: async () => { await audio.play(); }
			});
			// Aguarda o usuário tocar antes de prosseguir.
			await new Promise<void>((resolve) => {
				const onEnd = () => { audio.removeEventListener('ended', onEnd); resolve(); };
				audio.addEventListener('ended', onEnd);
				const onPlay = () => { audio.removeEventListener('play', onPlay); /* esperamos onEnd */ };
				audio.addEventListener('play', onPlay);
			});
			return;
		}
		// aguarda fim do áudio
		await new Promise<void>((resolve) => {
			const onEnd = () => { audio.removeEventListener('ended', onEnd); resolve(); };
			audio.addEventListener('ended', onEnd);
		});
	}

	private async setState(s: EngineState): Promise<void> {
		this.state = s;
		this.emit({ type: 'state', state: s });
		// Pequeno yield para a UI atualizar antes de qualquer await pesado.
		await Promise.resolve();
	}

	private emit(event: EngineEvent): void {
		for (const l of this.listeners) {
			try { l(event); } catch (e) { console.error('listener error', e); }
		}
	}
}
