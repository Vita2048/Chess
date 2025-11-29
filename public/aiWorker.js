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

function orderMoves(moves) {
    return moves.sort((a, b) => {
        let scoreA = 0, scoreB = 0;
        if (a.captured) scoreA = 10 * getPieceValueSimple(a.captured) - getPieceValueSimple(a.piece);
        if (b.captured) scoreB = 10 * getPieceValueSimple(b.captured) - getPieceValueSimple(b.piece);
        if (a.promotion) scoreA += 1000;
        if (b.promotion) scoreB += 1000;
        return scoreB - scoreA;
    });
}

function getPieceValueSimple(pieceType) {
    if (!pieceType) return 0;
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    return values[pieceType] || 0;
}

// OPTIMIZATION: Removed heavy checkmate logic from here
function evaluateBoard(game) {
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

// --- Minimax with Quiescence Search ---

// Quiescence Search: Keeps looking at captures after depth runs out
// to prevent the "Horizon Effect"
function quiescence(alpha, beta, isMaximizingPlayer, game) {
    const standPat = evaluateBoard(game);
    
    if (isMaximizingPlayer) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
    } else {
        if (standPat <= alpha) return alpha;
        if (standPat < beta) beta = standPat;
    }

    // Only look at aggressive moves (captures/promotions)
    let moves = game.moves({ verbose: true });
    // Filter for captures only
    moves = moves.filter(m => m.captured || m.promotion);
    moves = orderMoves(moves);

    for (let i = 0; i < moves.length; i++) {
        game.move(moves[i]);
        // Recursively call quiescence (infinite depth for captures, but naturally self-limiting)
        const score = quiescence(alpha, beta, !isMaximizingPlayer, game);
        game.undo();

        if (isMaximizingPlayer) {
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        } else {
            if (score <= alpha) return alpha;
            if (score < beta) beta = score;
        }
    }
    return isMaximizingPlayer ? alpha : beta;
}

function minimax(depth, alpha, beta, isMaximizingPlayer, game) {
    // Check for Game Over via move list length (Much faster than in_checkmate)
    // We do this check implicitly by seeing if loop runs, but to be precise:
    // If depth is 0, switch to Quiescence Search
    if (depth === 0) {
        return quiescence(alpha, beta, isMaximizingPlayer, game);
    }

    let newGameMoves = game.moves({ verbose: true });
    
    // Check for Mate/Stalemate
    if (newGameMoves.length === 0) {
        if (game.in_check()) {
            return isMaximizingPlayer ? -20000 : 20000; // Checkmate
        }
        return 0; // Stalemate
    }

    newGameMoves = orderMoves(newGameMoves);

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

function minimaxRoot(depth, isMaximizingPlayer, game) {
    let newGameMoves = game.moves({ verbose: true });
    newGameMoves = orderMoves(newGameMoves);
    let bestMove = isMaximizingPlayer ? -Infinity : Infinity;
    let bestMoveFound = undefined;

    for (let i = 0; i < newGameMoves.length; i++) {
        game.move(newGameMoves[i]);
        // Note: root calls minimax which now includes quiescence
        const value = minimax(depth - 1, -Infinity, Infinity, !isMaximizingPlayer, game);
        game.undo();

        if (isMaximizingPlayer) {
            if (value >= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        } else {
            if (value <= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    }
    // Fallback if no move found (rare, usually means mate detected)
    return bestMoveFound || newGameMoves[0];
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

// --- Stockfish Integration ---
let stockfish = null;
let stockfishReady = false;

function initStockfish() {
    if (stockfish) return;
    stockfish = new Worker('/Chess/stockfish.js'); 

    stockfish.onmessage = function (event) {
        const line = event.data;
        if (line === 'uciok') {
            stockfishReady = true;
        }
    };
    stockfish.postMessage('uci');
}

function getBestMoveStockfish(fen, skillLevel) {
    return new Promise((resolve) => {
        if (!stockfish) initStockfish();
        stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
        stockfish.postMessage(`position fen ${fen}`);
        
        // Increased limits for better play
        let depth = 5;
        let movetime = 500;
        if (skillLevel >= 20) { depth = 20; movetime = 2000; }
        else if (skillLevel >= 15) { depth = 15; movetime = 1500; }
        else if (skillLevel >= 10) { depth = 10; movetime = 1000; }
        else { depth = 5; movetime = 500; }

        stockfish.postMessage(`go depth ${depth} movetime ${movetime}`);

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
            const move = game.move(bestMoveLan, { sloppy: true });
            postMessage(move);
        } catch (err) {
            console.error("Stockfish error:", err);
            const bestMove = getBestMoveLocal(game, 'moderate');
            postMessage(bestMove);
        }
    } else {
        const bestMove = getBestMoveLocal(game, difficulty);
        postMessage(bestMove);
    }
};