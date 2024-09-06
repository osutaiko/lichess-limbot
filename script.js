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

const ENGINE_DEPTH = 10;

let chessEngine = window.STOCKFISH();
let currentFen = "";
let currentEval = 0.0;
let webSocketWrapper = null;
let nextMoveNumber = 1;
let candidateMoves = [];
let isBotWhite = null;

// Set the engine to return multiple moves (MultiPV)
chessEngine.postMessage("setoption name MultiPV value 10");

const getMoveDelay = () => {
    const baseDelay = 300;
    // Rate parameter of exponential distribution (inverse of mean delay)
    const lambda = 1 / 900;
    const randomizedDelay = -Math.log(1 - Math.random()) / lambda;

    if (candidateMoves.length <= 1) {
        return baseDelay;
    }

    if (nextMoveNumber <= 5) {
        return baseDelay + randomizedDelay * 0.2;
    } else if (nextMoveNumber <= 20) {
        return baseDelay + randomizedDelay;
    } else if (nextMoveNumber <= 30) {
        return baseDelay + randomizedDelay * 0.4;
    } else {
        return 0;
    }
}

const getTargetEvaluation = () => {
    let absTargetEvaluation;

    absTargetEvaluation = nextMoveNumber * nextMoveNumber * 0.003;

    return isBotWhite ? absTargetEvaluation : -absTargetEvaluation;
}

const sendMove = (move) => {
    const moveDelay = getMoveDelay();

    setTimeout(() => {
        if (webSocketWrapper && move) {
            console.log(`${nextMoveNumber}${isBotWhite ? "." : "..."} ${move}: ${currentEval.toFixed(2)} (target ${getTargetEvaluation().toFixed(2)}) (${Math.floor(moveDelay)} ms)`);

            webSocketWrapper.send(JSON.stringify({
                t: "move",
                d: { u: move, b: 1, l: 100, a: 1 }
            }));
        }
    }, moveDelay);
};

chessEngine.onmessage = function(event) {
    if (event.includes(`info depth ${ENGINE_DEPTH}`)) {
        const moveMatch = event.match(/\spv\s+(\S+)/);
        const evalMatch = event.match(/score cp (-?\d+)/);

        if (moveMatch && evalMatch) {
            const candidateMove = moveMatch[1];
            const candidateMoveEval = evalMatch[1] / 100;

            candidateMoves.push({ move: candidateMove, eval: candidateMoveEval });
        }
    }

    // Triggers on computation end
    if (event.includes("bestmove")) {
        let closestMove = null;
        let minEvalDifference = Infinity;
        const targetEvaluation = getTargetEvaluation();

        for (const candidate of candidateMoves) {
            const evalDifference = Math.abs(candidate.eval - targetEvaluation);
            if (evalDifference < minEvalDifference) {
                closestMove = candidate.move;
                minEvalDifference = evalDifference;
                currentEval = candidate.eval;
            }
        }

        sendMove(closestMove);
        candidateMoves = [];
    }
};

window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args) {
        const wsInstance = new target(...args);
        webSocketWrapper = wsInstance;

        wsInstance.addEventListener("message", event => {
            try {
                const message = JSON.parse(event.data);
                const isWhitesTurn = message.v % 2 === 0;

                if (isBotWhite ^ isWhitesTurn) {
                    return;
                }

                if (message.d?.fen && typeof message.v === "number") {
                    currentFen = `${message.d.fen} ${isWhitesTurn ? "w KQkq" : "b KQkq"}`;
                    nextMoveNumber = Math.floor((message.v + 1) / 2);

                    chessEngine.postMessage(`position fen ${currentFen}`);
                    chessEngine.postMessage(`go depth ${ENGINE_DEPTH}`);
                }
            } catch (error) {
                console.error("Error processing WebSocket message:", error);
            }
        });

        return wsInstance;
    }
});

const initializeBot = async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Get color information from innerHTML class
    isBotWhite = document.documentElement.innerHTML.includes("orientation-white");
    console.log(`Limbot playing as: ${isBotWhite ? "white" : "black"}`);

    if (isBotWhite) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        chessEngine.postMessage(`go depth ${ENGINE_DEPTH}`);
    }
};

initializeBot();
