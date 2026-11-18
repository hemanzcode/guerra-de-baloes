# Balooons — Multiplayer no Render

Jogo multiplayer de arremesso de balões de água 3D em tempo real construído com Three.js e FastAPI WebSockets.

## Rodar localmente
Requer Python 3.11+.

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# Git Bash: source .venv/Scripts/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 127.0.0.1 --port 8000
```
Abra http://127.0.0.1:8000 em duas janelas do navegador. Uma cria sala; a outra entra pelo código.

## Publicar no Render
1. Envie estes arquivos para um repositório GitHub.
2. No Render, escolha **New + → Blueprint** e selecione o repositório que contém `render.yaml`.
3. Confirme a criação do serviço web. O Render instalará `requirements.txt` e iniciará o Uvicorn.
4. Abra o link HTTPS do serviço em ambos os computadores. Crie a sala e compartilhe o código com seu amigo.

## Limitações atuais
- O estado das salas fica na memória do processo. Reiniciar/reimplantar o serviço apaga as salas.
- Para MVP de teste, use uma única instância; não configure múltiplas instâncias, pois não compartilham estado.
- O servidor faz retransmissão de presença e projéteis, e guarda o estado da partida em memória; não há autenticação nem persistência durável.
- Three.js ainda é carregado pelo CDN do Cloudflare, então o navegador precisa de internet para carregar a biblioteca.
