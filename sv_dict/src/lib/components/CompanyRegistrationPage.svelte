<script lang="ts">
	import VoiceFormAssistant from './VoiceFormAssistant.svelte';
	import {
		companyRegistrationVoiceSchema,
		type CompanyRegistration
	} from '../voice/schemas/companyRegistrationVoiceSchema';

	let formData: Record<string, string> = $state({
		companyName: '',
		cnpj: '',
		phone: '',
		email: '',
		address: ''
	});

	let savedNotice = $state('');

	function update(field: string, value: string) {
		formData = { ...formData, [field]: value };
	}

	function onComplete(_data: Record<string, string>) {
		// Aqui o motor finalizou a coleta. A persistência fica a cargo do
		// "Existing Company Registration Service" no app PSI real.
		savedNotice = 'Coleta concluída. Revise os campos e clique em Salvar.';
	}

	function manualSave() {
		// Stub de salvar — no PSI real, chamaria o serviço de cadastro.
		savedNotice = `Cadastro pronto para envio:\n${JSON.stringify(formData, null, 2)}`;
	}
</script>

<section class="max-w-3xl w-full">
	<header class="mb-6">
		<h1 class="text-3xl font-light tracking-tight">Cadastro de empresa</h1>
		<p class="text-zinc-400 mt-1">
			Você pode preencher os dados falando naturalmente ou digitar diretamente.
		</p>
	</header>

	<div class="space-y-6">
		<VoiceFormAssistant
			schema={companyRegistrationVoiceSchema}
			{formData}
			onUpdate={update}
			{onComplete}
		/>

		<div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-xl">
			<h2 class="text-xl font-light mb-4">Dados da empresa</h2>
			<div class="grid grid-cols-1 gap-4">
				<label class="flex flex-col gap-1">
					<span class="text-sm text-zinc-400">Nome da empresa / clínica</span>
					<input
						class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-100"
						value={formData.companyName}
						oninput={(e) => update('companyName', (e.target as HTMLInputElement).value)}
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm text-zinc-400">CNPJ</span>
					<input
						class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-100"
						value={formData.cnpj}
						oninput={(e) => update('cnpj', (e.target as HTMLInputElement).value)}
						placeholder="00.000.000/0000-00"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm text-zinc-400">Telefone</span>
					<input
						class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-100"
						value={formData.phone}
						oninput={(e) => update('phone', (e.target as HTMLInputElement).value)}
						placeholder="(00) 00000-0000"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm text-zinc-400">E-mail</span>
					<input
						type="email"
						class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-100"
						value={formData.email}
						oninput={(e) => update('email', (e.target as HTMLInputElement).value)}
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-sm text-zinc-400">Endereço completo</span>
					<textarea
						class="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-100"
						value={formData.address}
						oninput={(e) => update('address', (e.target as HTMLTextAreaElement).value)}
						rows="2"
					></textarea>
				</label>
			</div>

			<div class="mt-5 flex gap-3">
				<button
					onclick={manualSave}
					class="flex-1 py-3 rounded-xl bg-white text-zinc-900 hover:bg-zinc-100 font-medium"
				>
					Salvar cadastro
				</button>
			</div>

			{#if savedNotice}
				<pre class="mt-4 p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs whitespace-pre-wrap">{savedNotice}</pre>
			{/if}
		</div>
	</div>
</section>
