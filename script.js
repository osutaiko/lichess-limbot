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

let chessEngine = window.STOCKFISH();
let currentEval = 0.0;
let webSocketWrapper = null;
let nextMoveNumber = 1;
let castlingRights = 'KQkq';
let movesList = [];
let candidateMoves = [];
let isBotWhite = null;

// Set the engine to return multiple moves (MultiPV)
chessEngine.postMessage("setoption name MultiPV value 8");

const getMoveDelay = () => {
    // Return minimal delay on trivial moves
    if (candidateMoves.length <= 2) {
        return 0;
    }

    const baseDelay = 300;

    if (nextMoveNumber <= 5) {
        return baseDelay;
    } else if (nextMoveNumber > 35) {
        return 0;
    }

    // Rate parameter of exponential distribution (inverse of mean delay)
    const lambda = 1 / 700;
    let randomizedDelay = -Math.log(1 - Math.random()) / lambda;

    if (Math.random() < 0.1) {
        randomizedDelay += 1000;
    }

    return baseDelay + randomizedDelay;
}

const getEngineDepth = () => {
    if (nextMoveNumber <= 30) {
        return 10;
    } else {
        return 8;
    }
}

const getTargetEvaluation = () => {
    return Math.max(0, 0.00015 * (nextMoveNumber ** 3));
}

/** For some reason, Lichess handles UCI notation differently from the standard.
 * For example, if White castles kingside, the correct notation to pass to Stockfish would be 'e1g1',
 * but Lichess sends 'e1h1' instead. (https://lichess.org/forum/lichess-feedback/lichess-castling-bug)
 */
const processCastlingMove = (move) => {
    const castlingConversions = {
        "e1h1": "e1g1",
        "e1a1": "e1c1",
        "e8h8": "e8g8",
        "e8a8": "e8c8"
    };

    if (castlingConversions[move]) {
        if (move === "e1" || move === "h1") castlingRights = castlingRights.replace("K", "");
        if (move === "e1" || move === "a1") castlingRights = castlingRights.replace("Q", "");
        if (move === "e8" || move === "h8") castlingRights = castlingRights.replace("k", "");
        if (move === "e8" || move === "a8") castlingRights = castlingRights.replace("q", "");

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
                d: { u: move, b: 1, l: 100, a: 1, s: 0 }
            }));
        }
    }, moveDelay);
};

chessEngine.onmessage = function(event) {
    if (event.includes(`info depth ${getEngineDepth()}`)) {
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
        movesList.push(closestMove);

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

                if (message.t === "move") {
                    nextMoveNumber = Math.floor((message.d.ply + 2) / 2);

                    const processedMove = processCastlingMove(message.d.uci);
                    movesList.push(processedMove);

                    chessEngine.postMessage(`position startpos moves ${movesList.join(' ')}`);
                    chessEngine.postMessage(`go depth ${getEngineDepth()}`);
                }
            } catch (error) {
                console.error("Error processing WebSocket message:", error);
            }
        });

        return wsInstance;
    }
});

const initializeBot = async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    // Get color information from innerHTML class
    isBotWhite = document.documentElement.innerHTML.includes("orientation-white");
    console.log(`Limbot playing as: ${isBotWhite ? "white" : "black"}`);

    // If bot is white, don't wait for "move" message to start the engine
    if (isBotWhite) {
        chessEngine.postMessage(`go depth ${getEngineDepth()}`);
    }
};

initializeBot();
