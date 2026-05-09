import type { ValidatorName, ValidationResult } from '../types';

/** Apenas verifica que existem 14 dígitos no valor (não valida DV). */
export function cnpjLengthOnly(value: string): ValidationResult {
	const digits = value.replace(/\D/g, '');
	if (digits.length === 14) return { ok: true };
	return {
		ok: false,
		reason: `CNPJ precisa ter 14 dígitos. Recebi ${digits.length}.`
	};
}

export function runValidator(
	name: ValidatorName | undefined,
	value: string
): ValidationResult {
	switch (name) {
		case 'cnpj_length_only':
			return cnpjLengthOnly(value);
		default:
			return { ok: true };
	}
}
