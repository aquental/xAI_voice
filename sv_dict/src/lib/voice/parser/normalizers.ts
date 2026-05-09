import type { NormalizerName, ParsedAnswer } from '../types';

const PT_DIGIT_WORDS: Record<string, string> = {
	zero: '0',
	um: '1',
	uma: '1',
	dois: '2',
	duas: '2',
	tres: '3',
	'três': '3',
	quatro: '4',
	cinco: '5',
	seis: '6',
	sete: '7',
	oito: '8',
	nove: '9',
	dez: '10',
	meia: '6'
};

/** Converte palavras-dígito ("um dois três") para dígitos. Não cobre dezenas/centenas (esperamos que o usuário fale dígito a dígito). */
function digitWordsToDigits(text: string): string {
	const cleaned = text
		.toLowerCase()
		.replace(/[.,;:!?()\-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const tokens = cleaned.split(' ');
	let out = '';
	for (const t of tokens) {
		if (PT_DIGIT_WORDS[t]) {
			out += PT_DIGIT_WORDS[t];
			continue;
		}
		// já é número (ex: "1520")
		if (/^\d+$/.test(t)) {
			out += t;
		}
	}
	return out;
}

/** CNPJ básico: extrai 14 dígitos e formata. Não valida dígitos verificadores (decisão do PRD). */
export function normalizeCnpj(value: string): ParsedAnswer {
	const fromDigits = value.replace(/\D/g, '');
	const fromWords = digitWordsToDigits(value);
	const digits = fromDigits.length >= fromWords.length ? fromDigits : fromWords;

	if (digits.length !== 14) {
		return { value: digits, display: digits, raw: value };
	}
	const formatted = digits.replace(
		/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
		'$1.$2.$3/$4-$5'
	);
	return { value: formatted, display: formatted, raw: value };
}

/** Telefone BR: 10 ou 11 dígitos, formato (XX) XXXXX-XXXX. */
export function normalizePhoneBr(value: string): ParsedAnswer {
	const fromDigits = value.replace(/\D/g, '');
	const fromWords = digitWordsToDigits(value);
	const digits = fromDigits.length >= fromWords.length ? fromDigits : fromWords;

	if (digits.length === 11) {
		const f = digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
		return { value: f, display: f, raw: value };
	}
	if (digits.length === 10) {
		const f = digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
		return { value: f, display: f, raw: value };
	}
	return { value: digits, display: digits, raw: value };
}

/** E-mail falado em pt-BR: "antonio arroba gmail ponto com" -> "antonio@gmail.com". */
export function normalizeEmailSpoken(value: string): ParsedAnswer {
	let s = value.toLowerCase().trim();
	// Substituições mais comuns
	s = s
		.replace(/\barroba\b/g, '@')
		.replace(/\bat\b/g, '@')
		.replace(/\bponto\b/g, '.')
		.replace(/\btraço\b/g, '-')
		.replace(/\btraco\b/g, '-')
		.replace(/\bunderline\b/g, '_')
		.replace(/\bunderscore\b/g, '_')
		.replace(/\bsublinhado\b/g, '_')
		.replace(/\bhifen\b/g, '-')
		.replace(/\bhífen\b/g, '-');
	// Remove espaços extras
	s = s.replace(/\s+/g, '');
	// Remove pontuação final acidental
	s = s.replace(/[.,;:!?]+$/g, '');
	return { value: s, display: s, raw: value };
}

/** Normalizador no-op para campos livres (nome, endereço). Apenas faz trim. */
export function normalizeFreeText(value: string): ParsedAnswer {
	const trimmed = value.replace(/\s+/g, ' ').trim();
	// Capitaliza a primeira letra (estética para nomes próprios)
	const cap = trimmed.length > 0
		? trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
		: trimmed;
	return { value: cap, display: cap, raw: value };
}

export function runNormalizer(name: NormalizerName | undefined, raw: string): ParsedAnswer {
	switch (name) {
		case 'cnpj_basic':
			return normalizeCnpj(raw);
		case 'phone_br':
			return normalizePhoneBr(raw);
		case 'email_spoken_pt_br':
			return normalizeEmailSpoken(raw);
		default:
			return normalizeFreeText(raw);
	}
}
