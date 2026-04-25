# pypoc-cadastro

PoC de preenchimento de cadastro de clínica por voz, usando a [xAI API](https://console.x.ai) (Grok) via biblioteca `openai`.

## Pré-requisitos

- Python 3.14+
- [uv](https://docs.astral.sh/uv/) instalado
- Conta ativa em [console.x.ai](https://console.x.ai) com créditos disponíveis

## Configuração

### 1. Variáveis de ambiente

Crie um arquivo `.env` na raiz do repositório (`xAI_voice/`) com sua API key:

```env
xAI_API_KEY=xai-sua-chave-aqui
```

> Obtenha sua chave em: https://console.x.ai → API Keys

### 2. Instalar dependências

Crie o ambiente virtual com Python 3.14 e instale as dependências:

```bash
uv venv .venv --python 3.14
VIRTUAL_ENV=.venv uv pip install python-dotenv openai
```

Ou instale a partir do `pyproject.toml`:

```bash
uv venv .venv --python 3.14
VIRTUAL_ENV=.venv uv pip install -r pyproject.toml
```

## Execução

```bash
.venv/bin/python main.py
```

## Fluxo da PoC

O app simula um atendente de voz que coleta os dados de cadastro da clínica em três etapas:

1. **Nome da clínica** — digitado pelo usuário (simula STT)
2. **Endereço completo** — digitado pelo usuário
3. **CNPJ** — digitado pelo usuário

Cada campo passa por extração via **Grok LLM** (`grok-3`) e confirmação antes de ser salvo.

> Em produção, `input()` é substituído por STT real (Grok STT / Web Speech API)
> e `print()` por TTS real (Grok TTS / on-device).

## Estrutura

```
pypoc_cadastro/
├── .venv/             # Ambiente virtual Python 3.14
├── .python-version    # Versão do Python (3.14)
├── main.py            # PoC principal
├── pyproject.toml     # Metadados e dependências
└── README.md          # Este arquivo
```

## Dependências

| Pacote | Versão | Uso |
|---|---|---|
| `openai` | >=1.0 | Cliente HTTP para a xAI API |
| `python-dotenv` | >=1.0 | Leitura do arquivo `.env` |

## Modelo e Endpoint

| Parâmetro | Valor |
|---|---|
| Base URL | `https://api.x.ai/v1` |
| Modelo | `grok-3` |
| Endpoint | `POST /chat/completions` |