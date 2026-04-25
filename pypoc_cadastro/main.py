"""
PoC – Preenchimento de Cadastro da Clínica por Voz
Demonstração usando xAI API (Grok) via biblioteca openai.
STT/TTS simulados por input()/print() nesta PoC.
Executar com: python main.py
"""

import json
import os

from dotenv import find_dotenv, load_dotenv
from openai import OpenAI

# Carrega .env (busca no diretório atual e nos diretórios pai)
load_dotenv(find_dotenv())

XAI_BASE_URL = "https://api.x.ai/v1"
MODEL = "grok-3"


class VoiceClinicPoC:
    def __init__(self):
        api_key = os.environ.get("xAI_API_KEY")
        if not api_key:
            raise ValueError("xAI_API_KEY não encontrada. Verifique o arquivo .env.")
        self.client = OpenAI(api_key=api_key, base_url=XAI_BASE_URL)
        self.clinica_data = {"nome": "", "endereco": "", "cnpj": ""}

    def speak(self, text: str):
        """TTS simulado — em produção usa Grok TTS / on-device."""
        print(f"\n🗣️  {text}")

    def listen(self, prompt: str) -> str:
        """STT simulado — em produção usa Grok STT / Web Speech API."""
        self.speak(prompt)
        return input("🎤  Você: ").strip()

    def extract_fields(self, text: str) -> dict:
        """Extrai nome, endereço e CNPJ via Grok LLM."""
        response = self.client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Você é um assistente especializado em extrair informações de texto falado em português. "
                        "Retorne APENAS um objeto JSON válido, sem markdown, sem explicações."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Extraia do texto abaixo os seguintes campos: "
                        "nome da clínica, endereço completo e CNPJ formatado (XX.XXX.XXX/XXXX-XX). "
                        "Retorne JSON com as chaves: nome, endereco, cnpj. "
                        "Se um campo não for encontrado, use string vazia.\n\n"
                        f"Texto: {text}"
                    ),
                },
            ],
            temperature=0,
        )
        raw = response.choices[0].message.content.strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # Fallback: retorna o texto no campo correspondente
            return {"nome": text, "endereco": text, "cnpj": text}

    def _confirmar(self, campo: str, valor: str, prompt_correcao: str, chave: str):
        """Confirmação por voz e correção se necessário."""
        resposta = self.listen(f"Confirma {campo} '{valor}'? (sim/não)")
        if "não" in resposta.lower():
            fala = self.listen(prompt_correcao)
            self.clinica_data[chave] = self.extract_fields(fala).get(chave, fala)

    def run(self):
        print("🚀  PoC – Cadastro da Clínica por Voz")
        print(f"   Modelo: {MODEL} | Base URL: {XAI_BASE_URL}\n")

        # Campo 1 – Nome
        fala = self.listen("Vamos preencher o cadastro da clínica. Qual o nome da clínica?")
        self.clinica_data["nome"] = self.extract_fields(fala).get("nome", fala)
        self._confirmar("nome", self.clinica_data["nome"], "Qual o nome correto?", "nome")

        # Campo 2 – Endereço
        fala = self.listen("Qual o endereço completo?")
        self.clinica_data["endereco"] = self.extract_fields(fala).get("endereco", fala)
        self._confirmar("endereço", self.clinica_data["endereco"], "Qual o endereço correto?", "endereco")

        # Campo 3 – CNPJ
        fala = self.listen("Qual o CNPJ?")
        self.clinica_data["cnpj"] = self.extract_fields(fala).get("cnpj", fala)
        self._confirmar("CNPJ", self.clinica_data["cnpj"], "Qual o CNPJ correto?", "cnpj")

        # Resumo final
        self.speak(
            f"Cadastro concluído! "
            f"Nome: {self.clinica_data['nome']}. "
            f"Endereço: {self.clinica_data['endereco']}. "
            f"CNPJ: {self.clinica_data['cnpj']}. "
            f"Tudo correto?"
        )
        print("\n✅  Dados salvos:", self.clinica_data)


if __name__ == "__main__":
    poc = VoiceClinicPoC()
    poc.run()
