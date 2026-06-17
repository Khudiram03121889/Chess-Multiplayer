import { Chess, Move, Square } from 'chess.js';

type BotColor = 'w' | 'b';

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6']);

const moveToUci = (move: Move) => `${move.from}${move.to}${move.promotion || ''}`;

const evaluate = (chess: Chess, botColor: BotColor) => {
  if (chess.isCheckmate()) {
    return chess.turn() === botColor ? -100000 : 100000;
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    return 0;
  }

  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] || 0;
      score += piece.color === botColor ? value : -value;
    }
  }

  const moves = chess.moves({ verbose: true }) as Move[];
  for (const move of moves) {
    const sign = move.color === botColor ? 1 : -1;
    if (CENTER_SQUARES.has(move.to)) score += sign * 8;
    else if (NEAR_CENTER_SQUARES.has(move.to)) score += sign * 3;
    if (move.flags.includes('c') || move.flags.includes('e')) score += sign * 20;
    if (move.promotion) score += sign * (PIECE_VALUES[move.promotion] || 0);
  }

  if (chess.inCheck()) {
    score += chess.turn() === botColor ? -30 : 30;
  }

  return score;
};

const orderMoves = (moves: Move[]) => {
  return [...moves].sort((a, b) => {
    const scoreMove = (move: Move) => {
      let score = 0;
      if (move.captured) score += 1000 + (PIECE_VALUES[move.captured] || 0) - (PIECE_VALUES[move.piece] || 0);
      if (move.promotion) score += PIECE_VALUES[move.promotion] || 0;
      if (CENTER_SQUARES.has(move.to)) score += 10;
      return score;
    };
    return scoreMove(b) - scoreMove(a);
  });
};

const minimax = (chess: Chess, depth: number, alpha: number, beta: number, botColor: BotColor): number => {
  if (depth === 0 || chess.isGameOver()) {
    return evaluate(chess, botColor);
  }

  const moves = orderMoves(chess.moves({ verbose: true }) as Move[]);
  if (moves.length === 0) {
    return evaluate(chess, botColor);
  }

  if (chess.turn() === botColor) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta, botColor));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    chess.move(move);
    best = Math.min(best, minimax(chess, depth - 1, alpha, beta, botColor));
    chess.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
};

export const getFallbackBotMove = (fen: string, depth = 2): string | null => {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return null;

  const botColor = chess.turn() as BotColor;
  const legalMoves = orderMoves(chess.moves({ verbose: true }) as Move[]);
  let bestMove: Move | null = null;
  let bestScore = -Infinity;

  for (const move of legalMoves) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, botColor);
    chess.undo();

    if (!bestMove || score > bestScore) {
      bestMove = move;
      bestScore = score;
    }
  }

  return bestMove ? moveToUci(bestMove) : null;
};

export const squareFromUci = (uci: string) => ({
  from: uci.substring(0, 2) as Square,
  to: uci.substring(2, 4) as Square,
  promotion: uci.length > 4 ? uci.charAt(4) : undefined,
});
