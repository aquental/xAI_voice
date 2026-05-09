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

/** Interpreta "sim"/"não" do usuário em português.
 *  Tolerante a ruídos: o xAI às vezes transcreve "sim" como "sí" (espanhol),
 *  "see"/"sea" (inglês) ou insere caracteres CJK/kana de fundo.
 *  Usa normalização NFD para que \b funcione com caracteres acentuados. */
export function parseYesNo(text: string): 'yes' | 'no' | 'unknown' {
	const s = text.toLowerCase().trim();
	if (!s) return 'unknown';

	// NFD: remove diacríticos para que \b funcione com "sí" → "si", "não" → "nao", etc.
	const sn = s.normalize('NFD').replace(/[̀-ͯ]/g, '');

	// "não" tem prioridade para evitar falsos positivos.
	// "no" foi removido — é preposição comum em PT-BR ("no Brasil").
	const noRe = /\b(nao|errado|incorreto|negativo|ta\s*errado|repete|repetir|de\s*novo|nope)\b/;
	const yesRe = /\b(sim|si|isso|isso\s*mesmo|correto|certo|exato|exatamente|confirmo|confirma|positivo|ok|okay|ta\s*certo|tudo\s*certo|pode|claro|com\s*certeza|afirmativo|yes|yep|yeah)\b/;

	if (noRe.test(sn)) return 'no';
	if (yesRe.test(sn)) return 'yes';

	// Remove caracteres não-latinos (CJK, kana, árabe…) e reavalia.
	// O xAI multilíngue às vezes mistura scripts no mesmo resultado.
	const latin = sn.replace(/[^ -\x7f\s]/g, '').trim();
	if (latin && latin !== sn) {
		if (noRe.test(latin)) return 'no';
		if (yesRe.test(latin)) return 'yes';
	}

	// Heurística fonética: palavras de 2-4 letras que começam com 's' e
	// soam como "sim" (ex: "see", "sea"). Só aplica quando a resposta
	// inteira é uma única palavra curta.
	const words = (latin || sn).split(/\s+/).filter(Boolean);
	if (words.length === 1) {
		const w = words[0].replace(/[^a-z]/g, '');
		if (w.length >= 2 && w.length <= 4 && w.startsWith('s') && !/^(sem|seu|sua|ser)/.test(w)) {
			return 'yes';
		}
		if (w === 'no' || w === 'nao' || w === 'nau') return 'no';
	}

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
