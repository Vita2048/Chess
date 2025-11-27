importScripts('https://cdn.jsdelivr.net/npm/chess.js@0.12.1/chess.min.js');



// --- Local Heuristics (Minimax) ---
const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const pawnEvalWhite = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0]
];
const knightEval = [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50]
];
const bishopEvalWhite = [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20]
];
const rookEvalWhite = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0]
];
const queenEval = [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20]
];
const kingEvalWhite = [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20]
];

function orderMoves(moves, game) {
    return moves.sort((a, b) => {
        let scoreA = 0, scoreB = 0;
        if (a.captured) scoreA = 10 * getPieceValueSimple(a.captured) - getPieceValueSimple(a.piece);
        if (b.captured) scoreB = 10 * getPieceValueSimple(b.captured) - getPieceValueSimple(b.piece);
        if (a.promotion) scoreA += 1000;
        if (b.promotion) scoreB += 1000;
        if (a.san.includes('+')) scoreA += 500;
        if (b.san.includes('+')) scoreB += 500;
        return scoreB - scoreA;
    });
}

function getPieceValueSimple(pieceType) {
    if (!pieceType) return 0;
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    return values[pieceType] || 0;
}

function evaluateBoard(game) {
    if (game.in_checkmate()) return game.turn() === 'w' ? -20000 : 20000;
    if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) return 0;
    let totalEvaluation = 0;
    const board = game.board();
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            totalEvaluation += getPieceValue(board[i][j], i, j);
        }
    }
    return totalEvaluation;
}

function getPieceValue(piece, x, y) {
    if (piece === null) return 0;
    const absoluteValue = getAbsoluteValue(piece, piece.color === 'w', x, y);
    return piece.color === 'w' ? absoluteValue : -absoluteValue;
}

function getAbsoluteValue(piece, isWhite, x, y) {
    let row = isWhite ? x : 7 - x;
    let col = y;
    const value = pieceValues[piece.type];
    let positionValue = 0;
    switch (piece.type) {
        case 'p': positionValue = pawnEvalWhite[row][col]; break;
        case 'r': positionValue = rookEvalWhite[row][col]; break;
        case 'n': positionValue = knightEval[row][col]; break;
        case 'b': positionValue = bishopEvalWhite[row][col]; break;
        case 'q': positionValue = queenEval[row][col]; break;
        case 'k': positionValue = kingEvalWhite[row][col]; break;
    }
    return value + positionValue;
}

function getBestMoveLocal(game, difficulty) {
    let depth;
    switch (difficulty) {
        case 'easy': depth = 2; break;
        case 'moderate': depth = 3; break;
        case 'hard': depth = 4; break;
        default: depth = 3;
    }
    const isMaximizingPlayer = game.turn() === 'w';
    return minimaxRoot(depth, isMaximizingPlayer, game);
}

function minimaxRoot(depth, isMaximizingPlayer, game) {
    let newGameMoves = game.moves({ verbose: true });
    newGameMoves = orderMoves(newGameMoves, game);
    let bestMove = -9999;
    let bestMoveFound = undefined;

    if (isMaximizingPlayer) {
        bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            const value = minimax(depth - 1, -Infinity, Infinity, false, game);
            game.undo();
            if (value >= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    } else {
        bestMove = Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            const value = minimax(depth - 1, -Infinity, Infinity, true, game);
            game.undo();
            if (value <= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    }
    return bestMoveFound;
}

function minimax(depth, alpha, beta, isMaximizingPlayer, game) {
    if (depth === 0) return evaluateBoard(game);
    let newGameMoves = game.moves({ verbose: true });
    newGameMoves = orderMoves(newGameMoves, game);

    if (isMaximizingPlayer) {
        let bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.max(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            alpha = Math.max(alpha, bestMove);
            if (beta <= alpha) return bestMove;
        }
        return bestMove;
    } else {
        let bestMove = Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.min(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            beta = Math.min(beta, bestMove);
            if (beta <= alpha) return bestMove;
        }
        return bestMove;
    }
}

// --- Stockfish Integration ---
let stockfish = null;
let stockfishReady = false;

function initStockfish() {
    if (stockfish) return;
    stockfish = new Worker('/Chess/stockfish.js'); // Use the downloaded file

    stockfish.onmessage = function (event) {
        const line = event.data;
        // console.log('Stockfish:', line);

        if (line === 'uciok') {
            stockfishReady = true;
        }
    };

    stockfish.postMessage('uci');
}

function getBestMoveStockfish(fen, skillLevel) {
    return new Promise((resolve) => {
        if (!stockfish) initStockfish();

        // Wait for ready (simplified, might need better handling)

        // Configure Stockfish
        stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
        stockfish.postMessage(`position fen ${fen}`);

        // Time management or depth based on skill?
        // For now, use a fixed depth or time based on skill to ensure responsiveness
        // Higher skill = more time/depth
        let depth = 5;
        let movetime = 500;

        if (skillLevel >= 20) { depth = 20; movetime = 2000; }
        else if (skillLevel >= 15) { depth = 15; movetime = 1500; }
        else if (skillLevel >= 10) { depth = 10; movetime = 1000; }
        else { depth = 5; movetime = 500; }

        stockfish.postMessage(`go depth ${depth} movetime ${movetime}`);

        // Set up one-time listener for the result
        const listener = function (event) {
            const line = event.data;
            if (line.startsWith('bestmove')) {
                const moveSan = line.split(' ')[1];
                stockfish.removeEventListener('message', listener);
                resolve(moveSan);
            }
        };
        stockfish.addEventListener('message', listener);
    });
}

// --- Main Worker Handler ---
onmessage = async function (e) {
    const fen = e.data.fen;
    const difficulty = e.data.difficulty;
    const game = new Chess(fen);

    if (difficulty.startsWith('stockfish_')) {
        const skillLevel = parseInt(difficulty.split('_')[1], 10);
        try {
            const bestMoveLan = await getBestMoveStockfish(fen, skillLevel);
            // Convert LAN (e2e4) to Chess.js move object
            const move = game.move(bestMoveLan, { sloppy: true });
            postMessage(move);
        } catch (err) {
            console.error("Stockfish error:", err);
            // Fallback to local
            const bestMove = getBestMoveLocal(game, 'moderate');
            postMessage(bestMove);
        }
    } else {
        const bestMove = getBestMoveLocal(game, difficulty);
        postMessage(bestMove);
    }
};