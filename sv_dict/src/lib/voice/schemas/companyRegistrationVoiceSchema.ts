import type { VoiceFormSchema } from '../types';

export type CompanyRegistration = {
	companyName: string;
	cnpj: string;
	phone: string;
	email: string;
	address: string;
};

export const companyRegistrationVoiceSchema: VoiceFormSchema<CompanyRegistration> = {
	formType: 'company_registration',
	language: 'pt-BR',
	introMessage:
		'Vamos cadastrar os dados da sua empresa. Vou fazer uma pergunta por vez.',
	completionMessage:
		'Pronto. Revise os dados na tela e confirme para salvar.',
	steps: [
		{
			id: 'companyName',
			field: 'companyName',
			prompt: 'Qual é o nome da empresa ou clínica?',
			required: true,
			confirmationRequired: false,
			parserHint: 'Nome jurídico, nome fantasia ou nome da clínica.'
		},
		{
			id: 'cnpj',
			field: 'cnpj',
			prompt: 'Qual é o CNPJ? Você pode falar os números devagar ou digitar.',
			required: true,
			confirmationRequired: true,
			normalizer: 'cnpj_basic',
			validator: 'cnpj_length_only'
		},
		{
			id: 'phone',
			field: 'phone',
			prompt: 'Qual é o telefone principal da clínica?',
			required: true,
			confirmationRequired: true,
			normalizer: 'phone_br'
		},
		{
			id: 'email',
			field: 'email',
			prompt: 'Qual é o e-mail principal?',
			required: true,
			confirmationRequired: true,
			normalizer: 'email_spoken_pt_br'
		},
		{
			id: 'address',
			field: 'address',
			prompt:
				'Qual é o endereço da clínica? Pode falar rua, número, complemento, bairro, cidade e estado.',
			required: true,
			confirmationRequired: true,
			parserHint:
				'Extrair rua, número, complemento, bairro, cidade, estado e CEP quando disponível.'
		}
	]
};
