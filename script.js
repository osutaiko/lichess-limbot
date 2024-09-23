// ==UserScript==
// @name         Limbot
// @namespace    http://tampermonkey.net/
// @version      2024-09-03
// @description  Annoying chess bot for Lichess
// @author       osutaiko
// @match        *://lichess.org/*
// @icon         https://cdn-icons-png.freepik.com/512/7658/7658220.png
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/NuroC/stockfish.js/stockfish.js
// ==/UserScript==

// Options for auto-seeking new game: null (don't restart), "new tab" (open new tab), "current tab" (restart in current tab)
const NEW_GAME_OPTION = null;

// Delay between games
const NEW_GAME_DELAY = 5000;

let chessEngine = window.STOCKFISH();
let webSocketWrapper = null;
let nextMoveNumber = 1;
let currentEval = 0.0;
let castlingRights = "KQkq";
let movesList = [];
let candidateMoves = [];
let isBotWhite = null;

// UI
const botPanel = document.createElement('div');
botPanel.id = 'limbot-panel';
botPanel.style.position = 'fixed';
botPanel.style.top = '10px';
botPanel.style.right = '10px';
botPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
botPanel.style.color = 'white';
botPanel.style.padding = '10px';
botPanel.style.borderRadius = '5px';
botPanel.style.zIndex = 1000;
document.body.appendChild(botPanel);

let logScore = "0/0";

const updateUIPanel = () => {
  botPanel.innerHTML = `
    <strong>Limbot</strong><br>
    ${isBotWhite ? currentEval.toFixed(2) : (-currentEval).toFixed(2)}
    (Target ${isBotWhite ? getTargetEvaluation().toFixed(2) : (-getTargetEvaluation()).toFixed(2)})<br>
    Limbot Score: ${logScore}
  `;
};

const updateScoreFromGameLog = () => {
  const gameLog = JSON.parse(localStorage.getItem('botGameLog')) || [];
  let score = 0, totalGames = gameLog.length;

  gameLog.forEach(game => {
    if (game.result.winner === (game.botColor === "white" ? "white" : "black")) {
      score += 1;
    } else if (game.result.winner === null) {
      score += 0.5;
    }
  });

  // Tournament-style score (e.g., 7.5/8) assuming no draws
  logScore = `${score}/${totalGames}`;
  updateUIPanel();
};

// Set the engine to return multiple moves (MultiPV)
chessEngine.postMessage("setoption name MultiPV value 8");

const getMoveDelay = () => {
  // Return minimal delay on trivial moves (very few move options, or recaptures)
  if (
    candidateMoves.length <= 2 ||
    (movesList.length >= 2 && movesList[movesList.length - 2].substring(2, 4) === movesList[movesList.length - 1].substring(2, 4))
  ) {
    return 0;
  }

  const baseDelay = 200;

  // Rate parameter of exponential distribution (inverse of mean delay)
  const lambda = 1 / 750;
  let randomizedDelay = -Math.log(1 - Math.random()) / lambda;

  if (nextMoveNumber <= 12) {
    return baseDelay + randomizedDelay * 0.2;
  } else if (nextMoveNumber <= 35) {
    if (Math.random() < 0.1) {
      randomizedDelay += 1000;
    }
    return baseDelay + randomizedDelay;
  } else {
    return 0;
  }
}

const getEngineDepth = () => {
  if (nextMoveNumber <= 30) {
    return 10;
  } else {
    return 8;
  }
}

//Target evaluation for the bot (positive if bot is ahead)
const getTargetEvaluation = () => {
  return Math.max(0, 0.000075 * (nextMoveNumber ** 3)) + 0.5;
}

const initializeBot = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // Get color information from innerHTML class
  isBotWhite = document.documentElement.innerHTML.includes("orientation-white");
  console.log(`Limbot playing as: ${isBotWhite ? "white" : "black"}`);

  // If bot is white, don't wait for "move" message to start the engine
  if (isBotWhite) {
    chessEngine.postMessage(`go depth ${getEngineDepth()}`);
  }

  updateScoreFromGameLog();
  updateUIPanel();
};

/** For some reason, Lichess handles UCI notation differently from the standard.
 * For example, if White castles kingside, the correct notation to pass to Stockfish would be "e1g1",
 * but Lichess sends "e1h1" instead. (https://lichess.org/forum/lichess-feedback/lichess-castling-bug)
 */
const processCastlingMove = (move) => {
  const castlingConversions = {
    "e1h1": "e1g1",
    "e1a1": "e1c1",
    "e8h8": "e8g8",
    "e8a8": "e8c8"
  };

  if (castlingConversions[move]) {
    if (move === "e1" || move === "h1") {
      castlingRights = castlingRights.replace("K", "")
    } else if (move === "e1" || move === "a1") {
      castlingRights = castlingRights.replace("Q", "")
    } else if (move === "e8" || move === "h8") {
      castlingRights = castlingRights.replace("k", "")
    } else if (move === "e8" || move === "a8") {
      castlingRights = castlingRights.replace("q", "")
    };
    return castlingConversions[move];
  }

  return move;
};

const sendMove = (move) => {
  const moveDelay = getMoveDelay();

  setTimeout(() => {
    if (webSocketWrapper && move) {
      if (isBotWhite) {
        console.log(`${nextMoveNumber}. ${move}: ${currentEval.toFixed(2)} (target ${getTargetEvaluation().toFixed(2)}) (${Math.floor(moveDelay)} ms)`);
      } else {
        console.log(`${nextMoveNumber}... ${move}: ${(-currentEval).toFixed(2)} (target ${(-getTargetEvaluation()).toFixed(2)}) (${Math.floor(moveDelay)} ms)`);
      }

      webSocketWrapper.send(JSON.stringify({
        t: "move",
        d: {
          u: move,
          b: 1,
          l: 100,
          a: 1,
          s: 0
        }
      }));
    }
  }, moveDelay);
};

chessEngine.onmessage = function(event) {
  if (event.includes(`info depth ${getEngineDepth()}`)) {
    const moveMatch = event.match(/\spv\s+(\S+)/);
    const evalMatch = event.match(/score cp (-?\d+)/);
    const mateInMatch = event.match(/score mate (-?\d+)/);

    if (moveMatch && (evalMatch || mateInMatch)) {
      const candidateMove = moveMatch[1];
      let candidateMoveEval = 0;

      if (evalMatch) {
        candidateMoveEval = evalMatch[1] / 100;
      } else if (mateInMatch) {
        candidateMoveEval = mateInMatch[1] > 0 ? 10000 : -10000
      }

      candidateMoves.push({
        move: candidateMove,
        eval: candidateMoveEval
      });
    }
  }

  // Triggers on computation end
  if (event.includes("bestmove")) {
    let closestMove = null;
    let minEvalDifference = 100000000;
    const targetEvaluation = getTargetEvaluation();

    candidateMoves.forEach((candidate) => {
      const evalDifference = Math.abs(candidate.eval - targetEvaluation);
      if (evalDifference < minEvalDifference) {
        closestMove = candidate.move;
        minEvalDifference = evalDifference;
        currentEval = candidate.eval;
      }
    });

    movesList.push(closestMove);
    sendMove(closestMove);
    candidateMoves = [];

    updateUIPanel();
  }
};

window.WebSocket = new Proxy(window.WebSocket, {
  construct(target, args) {
    const wsInstance = new target(...args);
    webSocketWrapper = wsInstance;

    wsInstance.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        const isWhitesTurn = message.v % 2 === 0;

        if (message.t === "move") {
          if (isBotWhite ^ isWhitesTurn) {
            return;
          }

          nextMoveNumber = Math.floor((message.d.ply + 2) / 2);
          const processedMove = processCastlingMove(message.d.uci);
          movesList.push(processedMove);

          chessEngine.postMessage(`position startpos moves ${movesList.join(" ")}`);
          chessEngine.postMessage(`go depth ${getEngineDepth()}`);
        } else if (message.t === "endData") {
          const currentUrl = window.location.href;
          const truncatedGameId = currentUrl.split('/').pop().substring(0, 8);

          const gameLogEntry = {
            gameId: truncatedGameId,
            botColor: isBotWhite ? "white" : "black",
            time: new Date().toISOString(),
            result: {
              winner: message.d.winner,
              endBy: message.d.status.name
            },
            clockOnEnd: {
              white: message.d.clock.wc,
              black: message.d.clock.bc
            }
          };

          try {
            let gameLog = JSON.parse(localStorage.getItem("botGameLog")) || [];
            gameLog.push(gameLogEntry);
            localStorage.setItem("botGameLog", JSON.stringify(gameLog));
            console.log("Game log updated:", gameLogEntry)
            updateScoreFromGameLog();
          } catch (error) {
            console.error("Error with localStorage:", error);
          }

          if (NEW_GAME_OPTION) {
            console.log(`Starting a new game in ${NEW_GAME_DELAY / 1000} seconds...`);
            setTimeout(() => {
              const newOpponentUrl = `https://lichess.org/?hook_like=${truncatedGameId}`;
              if (NEW_GAME_OPTION === "new tab") {
                window.open(newOpponentUrl, '_blank');
              } else if (NEW_GAME_OPTION === "current tab") {
                window.location.href = newOpponentUrl;
              }
            }, NEW_GAME_DELAY);
          }
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    return wsInstance;
  }
});

initializeBot();
