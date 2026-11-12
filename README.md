# Guerra de Balões — versão 2 (celular + multiplayer)

As mecânicas do jogo são as mesmas da versão original (5x5, melhor de 5 rounds, tanques, jipes, motos, helicópteros, portais, cubos X). Mudou a rede, o desempenho e os controles de celular.

## Como jogar com seu filho e os amigos

**Na mesma casa (Wi-Fi):** no PC, abra um terminal nesta pasta e rode `npm install` e depois `npm start`. O terminal mostra o endereço para o celular, algo como `http://192.168.0.10:3000`. Abra esse endereço em cada celular.

**Cada um na sua casa:** publique no Render (veja abaixo) e todos abrem o endereço `*.onrender.com`.

1. Quem for o anfitrião toca em **Criar sala** e depois em **Convidar amigos**, que manda um link pelo WhatsApp.
2. Os amigos abrem o link, digitam o nome e tocam em **Entrar**.
3. Cada um escolhe o time (azul ou vermelho). O anfitrião toca em **Iniciar partida**.
4. Se faltar gente, os bots completam os times (dá para desligar na sala).

As salas são **privadas**: só entra quem tem o código ou o link.

## O que mudou

- Rounds e cronômetro agora ficam no servidor. Se o celular do anfitrião apagar a tela, o jogo continua para todos.
- Os bots são simulados por um jogador e aparecem iguais para todos.
- Reconexão automática: se o Wi-Fi piscar, o jogador volta para a mesma vaga (até 25 segundos).
- Cubos X decididos pelo servidor (não dá mais para dois pegarem o mesmo).
- Nome sobre cada jogador, aviso de dano, marcador de acerto, lista de eliminações, câmera que acompanha um colega quando você é eliminado, tela de fim com "Jogar de novo".
- Celular: tela cheia, tela sempre ligada, aviso para girar o celular, mira na tela com ajuda de mira, vibração, sensibilidade ajustável, qualidade gráfica automática (ou manual) no botão ⚙.
- O cenário fixo é fundido em poucas peças, o que reduz bastante o esforço do celular.
- Corrigido um erro que impedia iniciar qualquer partida (a função `tocar` não existia).
- O three.js agora vem junto (`vendor/`), sem depender de internet externa.

## Rodar

```
npm install
npm start
```
Precisa do Node.js 20 ou mais novo. `http://localhost:3000/health` confirma que o servidor está no ar.

## Publicar no Render

1. Envie esta pasta para um repositório no GitHub.
2. No Render: **New > Blueprint**, escolha o repositório. Ele lê `render.yaml` e usa o `Dockerfile`.
3. Compartilhe o endereço `*.onrender.com`.

No plano gratuito o serviço dorme após alguns minutos sem uso e demora cerca de 1 minuto para acordar no primeiro acesso. As salas ficam na memória: se o serviço reiniciar, as salas abertas somem.

## Limites

O cálculo de física e de acertos é feito no celular de cada jogador (quem é atingido calcula o próprio dano). Para jogar entre amigos isso funciona bem, mas não impede trapaça.
