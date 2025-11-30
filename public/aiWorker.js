importScripts('https://cdn.jsdelivr.net/npm/chess.js@0.12.1/chess.min.js');

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
        else if (skillLevel >= 7) { depth = 7; movetime = 700; }
        else if (skillLevel >= 5) { depth = 5; movetime = 500; }
        else if (skillLevel >= 4) { depth = 4; movetime = 400; }
        else { depth = 3; movetime = 300; }

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

    const skillLevel = parseInt(difficulty.split('_')[1], 10);
    try {
        const bestMoveLan = await getBestMoveStockfish(fen, skillLevel);
        const move = game.move(bestMoveLan, { sloppy: true });
        postMessage(move);
    } catch (err) {
        console.error("Stockfish error:", err);
        // Fallback: random move or something, but since Stockfish is always used, maybe not needed
        postMessage(null);
    }
};