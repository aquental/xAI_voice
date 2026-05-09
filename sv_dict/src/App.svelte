<script lang="ts">
	import DictationView from './lib/components/DictationView.svelte';
	import CompanyRegistrationPage from './lib/components/CompanyRegistrationPage.svelte';

	type View = 'dictation' | 'company';
	let view: View = $state('company');
</script>

<main class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-8 font-sans">
	<nav class="max-w-3xl w-full flex gap-2 mb-6">
		<button
			class="px-4 py-2 rounded-xl font-medium {view === 'company'
				? 'bg-white text-zinc-900'
				: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}"
			onclick={() => (view = 'company')}
		>
			Cadastro por voz
		</button>
		<button
			class="px-4 py-2 rounded-xl font-medium {view === 'dictation'
				? 'bg-white text-zinc-900'
				: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}"
			onclick={() => (view = 'dictation')}
		>
			Ditado livre
		</button>
	</nav>

	<div class="w-full flex justify-center">
		{#if view === 'company'}
			<CompanyRegistrationPage />
		{:else}
			<DictationView />
		{/if}
	</div>
</main>
