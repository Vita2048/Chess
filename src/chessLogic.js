import { Chess } from 'chess.js';

export const game = new Chess();

export function resetGame() {
    game.reset();
}

export function getMoves(square) {
    return game.moves({ square: square, verbose: true });
}

export function makeMove(move) {
    return game.move(move);
}

export function isGameOver() {
    return game.isGameOver();
}

export function getFen() {
    return game.fen();
}

export function undoMove() {
    // If it's White's turn, it means Black just moved (or game start).
    // We want to undo Black's move AND White's move to get back to White's turn.
    if (game.turn() === 'w' && game.history().length >= 2) {
        game.undo(); // Undo Black's move
        game.undo(); // Undo White's move
        return true;
    } 
    return null;
}

export function saveGameXML() {
    const fen = game.fen();
    const pgn = game.pgn();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<chessgame>
    <fen>${fen}</fen>
    <pgn>${pgn}</pgn>
</chessgame>`;
    return xml;
}

export function loadGameXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    const fenNode = xmlDoc.getElementsByTagName("fen")[0];
    if (fenNode && fenNode.textContent) {
        const fen = fenNode.textContent;
        try {
            game.load(fen);
            return true;
        } catch (e) {
            console.error("Failed to load FEN:", e);
            return false;
        }
    }
    return false;
}
