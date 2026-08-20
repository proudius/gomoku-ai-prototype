"use client";

import { useEffect, useMemo, useState } from "react";

const BOARD_SIZE = 15;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
const STAR_POINTS = new Set(["3-3", "3-11", "7-7", "11-3", "11-11"]);
const COLUMN_LABELS = "ABCDEFGHJKLMNOP";

type Stone = 0 | 1 | 2;
type Player = 1 | 2;
type Turn = "human" | "ai";
type Winner = Turn | "draw" | null;
type Move = { row: number; col: number; player: Player };
type Snapshot = { board: Stone[][]; moves: Move[] };

const LEVELS = [
  { level: 1, name: "입문", description: "주변 빈칸에 무작위로 둡니다." },
  { level: 2, name: "초보", description: "당장 이기거나 막아야 할 수를 압니다." },
  { level: 3, name: "중수", description: "공격과 수비의 모양을 함께 평가합니다." },
  { level: 4, name: "고수", description: "상대의 다음 응수까지 예측합니다." },
  { level: 5, name: "달인", description: "3수 앞을 탐색하며 함정을 만듭니다." },
] as const;

function emptyBoard(): Stone[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array<Stone>(BOARD_SIZE).fill(0));
}

function inside(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function countSide(board: Stone[][], row: number, col: number, dr: number, dc: number, player: Player) {
  let count = 0;
  let r = row + dr;
  let c = col + dc;
  while (inside(r, c) && board[r][c] === player) {
    count += 1;
    r += dr;
    c += dc;
  }
  return { count, open: inside(r, c) && board[r][c] === 0 };
}

function wouldWin(board: Stone[][], row: number, col: number, player: Player) {
  if (board[row][col] !== 0) return false;
  return DIRECTIONS.some(([dr, dc]) => {
    const a = countSide(board, row, col, dr, dc, player);
    const b = countSide(board, row, col, -dr, -dc, player);
    return 1 + a.count + b.count >= 5;
  });
}

function isWinAt(board: Stone[][], row: number, col: number, player: Player) {
  return DIRECTIONS.some(([dr, dc]) => {
    const a = countSide(board, row, col, dr, dc, player);
    const b = countSide(board, row, col, -dr, -dc, player);
    return 1 + a.count + b.count >= 5;
  });
}

function patternScore(board: Stone[][], row: number, col: number, player: Player) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const a = countSide(board, row, col, dr, dc, player);
    const b = countSide(board, row, col, -dr, -dc, player);
    const length = 1 + a.count + b.count;
    const openEnds = Number(a.open) + Number(b.open);

    if (length >= 5) total += 10_000_000;
    else if (length === 4 && openEnds === 2) total += 500_000;
    else if (length === 4 && openEnds === 1) total += 80_000;
    else if (length === 3 && openEnds === 2) total += 18_000;
    else if (length === 3 && openEnds === 1) total += 2_400;
    else if (length === 2 && openEnds === 2) total += 700;
    else if (length === 2 && openEnds === 1) total += 110;
    else if (openEnds === 2) total += 24;
  }
  return total;
}

function candidates(board: Stone[][], radius = 2) {
  const result: Array<[number, number]> = [];
  let hasStone = false;
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== 0) hasStone = true;
    }
  }
  if (!hasStone) return [[7, 7] as [number, number]];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== 0) continue;
      let nearby = false;
      for (let dr = -radius; dr <= radius && !nearby; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (inside(row + dr, col + dc) && board[row + dr][col + dc] !== 0) {
            nearby = true;
            break;
          }
        }
      }
      if (nearby) result.push([row, col]);
    }
  }
  return result;
}

function tacticalScore(board: Stone[][], row: number, col: number, player: Player) {
  const opponent: Player = player === 1 ? 2 : 1;
  const centerBonus = 28 - (Math.abs(row - 7) + Math.abs(col - 7));
  return patternScore(board, row, col, player) * 1.12 + patternScore(board, row, col, opponent) + centerBonus;
}

function rankedMoves(board: Stone[][], player: Player, limit: number, radius = 2) {
  return candidates(board, radius)
    .map(([row, col]) => ({ row, col, score: tacticalScore(board, row, col, player) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function staticEvaluation(board: Stone[][]) {
  const ai = rankedMoves(board, 2, 5).reduce((sum, move, index) => sum + move.score / (index + 1), 0);
  const human = rankedMoves(board, 1, 5).reduce((sum, move, index) => sum + move.score / (index + 1), 0);
  return ai - human * 1.05;
}

function minimax(board: Stone[][], depth: number, maximizing: boolean, alpha: number, beta: number): number {
  if (depth === 0) return staticEvaluation(board);
  const player: Player = maximizing ? 2 : 1;
  const width = depth >= 2 ? 7 : 5;
  const moves = rankedMoves(board, player, width);
  if (moves.length === 0) return 0;

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      if (wouldWin(board, move.row, move.col, player)) return 100_000_000 + depth;
      board[move.row][move.col] = player;
      best = Math.max(best, minimax(board, depth - 1, false, alpha, beta));
      board[move.row][move.col] = 0;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    if (wouldWin(board, move.row, move.col, player)) return -100_000_000 - depth;
    board[move.row][move.col] = player;
    best = Math.min(best, minimax(board, depth - 1, true, alpha, beta));
    board[move.row][move.col] = 0;
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseAiMove(board: Stone[][], level: number): [number, number] | null {
  const nearby = candidates(board, level === 1 ? 1 : 2);
  if (nearby.length === 0) return null;
  if (level === 1) return nearby[Math.floor(Math.random() * nearby.length)];

  const winning = nearby.find(([row, col]) => wouldWin(board, row, col, 2));
  if (winning) return winning;
  const blocking = nearby.find(([row, col]) => wouldWin(board, row, col, 1));
  if (blocking) return blocking;

  const ranked = rankedMoves(board, 2, level === 2 ? 7 : 14);
  if (level === 2) {
    const pool = ranked.slice(0, Math.min(5, ranked.length));
    const choice = pool[Math.floor(Math.random() * pool.length)];
    return choice ? [choice.row, choice.col] : null;
  }
  if (level === 3) {
    const choice = ranked[0];
    return choice ? [choice.row, choice.col] : null;
  }
  if (level === 4) {
    let bestMove = ranked[0];
    let bestValue = -Infinity;
    for (const move of ranked.slice(0, 10)) {
      board[move.row][move.col] = 2;
      const reply = rankedMoves(board, 1, 8)[0]?.score ?? 0;
      const value = move.score - reply * 0.92 + staticEvaluation(board) * 0.08;
      board[move.row][move.col] = 0;
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
    }
    return bestMove ? [bestMove.row, bestMove.col] : null;
  }

  let bestMove = ranked[0];
  let bestValue = -Infinity;
  for (const move of ranked.slice(0, 10)) {
    board[move.row][move.col] = 2;
    const value = minimax(board, 3, false, -Infinity, Infinity) + move.score * 0.12;
    board[move.row][move.col] = 0;
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
  }
  return bestMove ? [bestMove.row, bestMove.col] : null;
}

export default function Home() {
  const [board, setBoard] = useState<Stone[][]>(() => emptyBoard());
  const [turn, setTurn] = useState<Turn>("human");
  const [winner, setWinner] = useState<Winner>(null);
  const [difficulty, setDifficulty] = useState(3);
  const [moves, setMoves] = useState<Move[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);

  const activeLevel = LEVELS[difficulty - 1];
  const lastMove = moves[moves.length - 1];
  const status = winner === "human"
    ? "승리! 흑돌이 오목을 완성했습니다."
    : winner === "ai"
      ? "AI 승리 — 다시 도전해 보세요."
      : winner === "draw"
        ? "무승부입니다. 판이 가득 찼어요."
        : turn === "ai"
          ? `AI가 생각 중입니다 · ${difficulty}단계 ${activeLevel.name}`
          : "당신의 차례입니다 · 흑돌";

  const moveLog = useMemo(() => moves.slice(-8).reverse(), [moves]);

  useEffect(() => {
    if (turn !== "ai" || winner) return;
    const timer = window.setTimeout(() => {
      const choice = chooseAiMove(board.map((row) => [...row]), difficulty);
      if (!choice) {
        setWinner("draw");
        return;
      }
      const [row, col] = choice;
      const next = board.map((line) => [...line]);
      next[row][col] = 2;
      const nextMoves = [...moves, { row, col, player: 2 as Player }];
      setHistory((current) => [...current, { board, moves }]);
      setBoard(next);
      setMoves(nextMoves);
      if (isWinAt(next, row, col, 2)) setWinner("ai");
      else if (nextMoves.length === BOARD_SIZE * BOARD_SIZE) setWinner("draw");
      else setTurn("human");
    }, 420);
    return () => window.clearTimeout(timer);
  }, [board, difficulty, moves, turn, winner]);

  function play(row: number, col: number) {
    if (turn !== "human" || winner || board[row][col] !== 0) return;
    const next = board.map((line) => [...line]);
    next[row][col] = 1;
    const nextMoves = [...moves, { row, col, player: 1 as Player }];
    setHistory((current) => [...current, { board, moves }]);
    setBoard(next);
    setMoves(nextMoves);
    if (isWinAt(next, row, col, 1)) setWinner("human");
    else if (nextMoves.length === BOARD_SIZE * BOARD_SIZE) setWinner("draw");
    else setTurn("ai");
  }

  function reset() {
    setBoard(emptyBoard());
    setTurn("human");
    setWinner(null);
    setMoves([]);
    setHistory([]);
  }

  function undoTurn() {
    if (history.length === 0) return;
    const steps = turn === "ai" || winner === "human" ? 1 : Math.min(2, history.length);
    const targetIndex = history.length - steps;
    const snapshot = history[targetIndex];
    setBoard(snapshot.board);
    setMoves(snapshot.moves);
    setHistory(history.slice(0, targetIndex));
    setWinner(null);
    setTurn("human");
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#game" aria-label="오목 연구소 게임으로 이동">
          <span className="brand-mark"><i /><i /></span>
          <span>오목 연구소</span>
        </a>
        <div className="header-note">15 × 15 · 5단계 AI</div>
      </header>

      <section className="hero" id="game">
        <div className="intro">
          <p className="eyebrow">GOMOKU · AI MATCH</p>
          <h1>다섯 단계의 수읽기.<br /><em>당신은 어디까지?</em></h1>
          <p className="lead">흑돌을 잡고 먼저 다섯 돌을 연결하세요. 입문부터 달인까지, 단계마다 AI의 판단 방식이 달라집니다.</p>
          <div className={`status ${winner ? "finished" : ""}`} role="status" aria-live="polite">
            <span className={`turn-stone ${turn}`} />
            <div><small>{winner ? "대국 종료" : moves.length === 0 ? "새 대국" : `${moves.length}수 진행 중`}</small><strong>{status}</strong></div>
          </div>
        </div>

        <div className="game-shell">
          <section className="board-card" aria-label="오목판">
            <div className="board-grid">
              {board.map((row, rowIndex) => row.map((stone, colIndex) => {
                const isLast = lastMove?.row === rowIndex && lastMove?.col === colIndex;
                const coordinate = `${COLUMN_LABELS[colIndex]}${BOARD_SIZE - rowIndex}`;
                return (
                  <button
                    className="intersection"
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    aria-label={`${coordinate}${stone === 1 ? ", 흑돌" : stone === 2 ? ", 백돌" : ", 빈칸"}`}
                    disabled={stone !== 0 || turn !== "human" || Boolean(winner)}
                    onClick={() => play(rowIndex, colIndex)}
                  >
                    {stone !== 0 && <span className={`stone ${stone === 1 ? "black" : "white"} ${isLast ? "last" : ""}`} />}
                    {stone === 0 && STAR_POINTS.has(`${rowIndex}-${colIndex}`) && <span className="star-point" />}
                  </button>
                );
              }))}
            </div>
          </section>

          <aside className="control-panel">
            <div className="panel-heading">
              <div><span>AI 난이도</span><strong>{difficulty}단계 · {activeLevel.name}</strong></div>
              <span className="level-badge">LV.{difficulty}</span>
            </div>

            <div className="level-list" role="radiogroup" aria-label="AI 난이도 선택">
              {LEVELS.map((item) => (
                <button
                  key={item.level}
                  type="button"
                  className={difficulty === item.level ? "active" : ""}
                  role="radio"
                  aria-checked={difficulty === item.level}
                  onClick={() => setDifficulty(item.level)}
                >
                  <span className="level-number">{item.level}</span>
                  <span><strong>{item.name}</strong><small>{item.description}</small></span>
                </button>
              ))}
            </div>

            <div className="actions">
              <button className="primary-action" type="button" onClick={reset}>새 대국</button>
              <button className="secondary-action" type="button" onClick={undoTurn} disabled={history.length === 0}>한 턴 무르기</button>
            </div>

            <div className="move-history">
              <div className="history-title"><span>최근 착수</span><small>{moves.length}/225</small></div>
              {moveLog.length === 0 ? <p>흑돌을 놓으면 대국이 시작됩니다.</p> : (
                <ol>
                  {moveLog.map((move, index) => (
                    <li key={`${moves.length - index}-${move.row}-${move.col}`}>
                      <span className={`mini-stone ${move.player === 1 ? "black" : "white"}`} />
                      <strong>{COLUMN_LABELS[move.col]}{BOARD_SIZE - move.row}</strong>
                      <small>{move.player === 1 ? "당신" : "AI"}</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </section>

      <footer><span>먼저 가로·세로·대각선으로 5개를 연결하면 승리합니다.</span><span>흑 선공 · 장목 허용</span></footer>
    </main>
  );
}
