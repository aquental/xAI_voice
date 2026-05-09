import type { ParsedAnswer, ValidationResult, VoiceFormStep } from '../types';
import { runNormalizer } from './normalizers';
import { runValidator } from './validators';

/** Heurística simples: detecta se a fala é uma pergunta fora do contexto.
 *  Usado para o critério de aceite CA08 (bloqueio de chatbot).
 *  Conservadora: só dispara quando começa com pronome interrogativo claro
 *  E não tem pista de ser um dado (ex: dígitos, @, etc.).
 */
export function looksLikeOffTopicQuestion(text: string): boolean {
	const s = text.trim().toLowerCase();
	if (!s) return false;
	if (/[@\d]/.test(s)) return false;
	const startsWithQuestionWord = /^(qual|quais|quem|onde|quando|por que|porque|como|por quê|por\s)/i.test(s);
	const endsWithQuestionMark = s.endsWith('?');
	return startsWithQuestionWord || endsWithQuestionMark;
}

/** Interpreta "sim"/"não" do usuário em português. */
export function parseYesNo(text: string): 'yes' | 'no' | 'unknown' {
	const s = text.toLowerCase().trim();
	if (!s) return 'unknown';
	const yes = /\b(sim|isso|isso\s*mesmo|correto|certo|exato|exatamente|confirmo|confirma|positivo|ok|okay|t[áa]\s*certo|tudo\s*certo)\b/;
	const no = /\b(n[ãa]o|errado|incorreto|negativo|t[áa]\s*errado|repete|repetir|de\s*novo)\b/;
	if (no.test(s)) return 'no';
	if (yes.test(s)) return 'yes';
	return 'unknown';
}

export type ParseOutcome =
	| { kind: 'value'; answer: ParsedAnswer }
	| { kind: 'invalid'; answer: ParsedAnswer; validation: ValidationResult }
	| { kind: 'offtopic_question' };

export function parseStepAnswer<T>(step: VoiceFormStep<T>, raw: string): ParseOutcome {
	if (looksLikeOffTopicQuestion(raw)) {
		return { kind: 'offtopic_question' };
	}
	const answer = runNormalizer(step.normalizer, raw);
	const validation = runValidator(step.validator, answer.value);
	if (!validation.ok) {
		return { kind: 'invalid', answer, validation };
	}
	if (step.required && answer.value.trim().length === 0) {
		return {
			kind: 'invalid',
			answer,
			validation: { ok: false, reason: 'Campo obrigatório vazio.' }
		};
	}
	return { kind: 'value', answer };
}
