"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

const CLASSIC_SIZE = 15;
const SCORE_SIZE = 9;
const COLS = "ABCDEFGHJKLMNOP";
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
const CLASSIC_STARS = new Set(["3-3", "3-11", "7-7", "11-3", "11-11"]);
const SCORE_STARS = new Set(["2-2", "2-6", "4-4", "6-2", "6-6"]);

type Stone = 0 | 1 | 2 | 3;
type Player = 1 | 2;
type Winner = Player | "draw" | null;
type GameMode = "classic" | "score9";
type AiKey = "human" | "v1" | "v2" | "v3" | "v4" | "v5" | "custom";
type Move = { row: number; col: number; player: Player };
type Snapshot = { board: Stone[][]; moves: Move[]; turn: Player };
type Telemetry = { nodes: number; depth: number; elapsed: number; source: string; move: string };
type Decision = { row: number; col: number; telemetry: Telemetry };
type BattleRow = { level: number; wins: number; draws: number; losses: number; errors: number };

const AI_LEVELS = [
  { key: "v1" as const, level: 1, name: "v1 무작위", method: "RANDOM", description: "주변의 합법 수 중 하나를 무작위로 선택합니다.", power: 18, depth: 0 },
  { key: "v2" as const, level: 2, name: "v2 전술", method: "WIN / BLOCK", description: "즉시 승리와 상대의 오목을 먼저 찾아 대응합니다.", power: 36, depth: 1 },
  { key: "v3" as const, level: 3, name: "v3 형태 평가", method: "HEURISTIC", description: "열린 3·4와 중앙 영향력을 점수로 비교합니다.", power: 58, depth: 1 },
  { key: "v4" as const, level: 4, name: "v4 응수 예측", method: "2-PLY", description: "내 수 뒤 상대의 가장 강한 응수까지 계산합니다.", power: 78, depth: 2 },
  { key: "v5" as const, level: 5, name: "v5 심화 탐색", method: "ALPHA-BETA", description: "후보 수를 좁힌 뒤 3수 알파베타 탐색을 수행합니다.", power: 100, depth: 3 },
];

const DEFAULT_CUSTOM_AI = `function chooseMove(state, me) {
  const opponent = me === 1 ? 2 : 1;
  const directions = [[1,0], [0,1], [1,1], [1,-1]];

  function score(move, player) {
    let value = 0;
    for (const [dr, dc] of directions) {
      let count = 1;
      for (const sign of [-1, 1]) {
        let r = move.row + dr * sign;
        let c = move.col + dc * sign;
        while (state.board[r]?.[c] === player) {
          count++; r += dr * sign; c += dc * sign;
        }
      }
      value += count >= 5 ? 100000 : count ** 4;
    }
    return value;
  }

  return [...state.legalMoves].sort((a, b) =>
    (score(b, me) * 1.2 + score(b, opponent)) -
    (score(a, me) * 1.2 + score(a, opponent))
  )[0];
}`;

const EMPTY_TELEMETRY: Telemetry = { nodes: 0, depth: 0, elapsed: 0, source: "대기", move: "—" };

function emptyBoard(size = CLASSIC_SIZE): Stone[][] {
  return Array.from({ length: size }, () => Array<Stone>(size).fill(0));
}

function createBoard(mode: GameMode): Stone[][] {
  if (mode === "classic") return emptyBoard(CLASSIC_SIZE);
  const board = emptyBoard(SCORE_SIZE);
  const cells = Array.from({ length: SCORE_SIZE * SCORE_SIZE }, (_, index) => index);
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [cells[index], cells[swap]] = [cells[swap], cells[index]];
  }
  const fillCount = Math.round(cells.length * 0.1);
  cells.slice(0, fillCount).forEach((cell) => { board[Math.floor(cell / SCORE_SIZE)][cell % SCORE_SIZE] = 3; });
  cells.slice(fillCount, fillCount * 2).forEach((cell) => { board[Math.floor(cell / SCORE_SIZE)][cell % SCORE_SIZE] = 1; });
  cells.slice(fillCount * 2, fillCount * 3).forEach((cell) => { board[Math.floor(cell / SCORE_SIZE)][cell % SCORE_SIZE] = 2; });
  return board;
}

function inside(board: Stone[][], row: number, col: number) {
  return row >= 0 && row < board.length && col >= 0 && col < board.length;
}

function coordinate(row: number, col: number, size = CLASSIC_SIZE) {
  return `${COLS[col]}${size - row}`;
}

function countSide(board: Stone[][], row: number, col: number, dr: number, dc: number, player: Player) {
  let count = 0;
  let r = row + dr;
  let c = col + dc;
  while (inside(board, r, c) && board[r][c] === player) {
    count += 1;
    r += dr;
    c += dc;
  }
  return { count, open: inside(board, r, c) && board[r][c] === 0 };
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

function countFiveLines(board: Stone[][], player: Player) {
  let score = 0;
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      for (const [dr, dc] of DIRECTIONS) {
        const endRow = row + dr * 4;
        const endCol = col + dc * 4;
        if (!inside(board, endRow, endCol)) continue;
        let complete = true;
        for (let step = 0; step < 5; step += 1) {
          if (board[row + dr * step][col + dc * step] !== player) { complete = false; break; }
        }
        if (complete) score += 1;
      }
    }
  }
  return score;
}

function scoreOutcome(board: Stone[][]) {
  const black = countFiveLines(board, 1);
  const white = countFiveLines(board, 2);
  const winner: Winner = black === white ? "draw" : black > white ? 1 : 2;
  return { black, white, winner };
}

function patternScore(board: Stone[][], row: number, col: number, player: Player) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const a = countSide(board, row, col, dr, dc, player);
    const b = countSide(board, row, col, -dr, -dc, player);
    const length = 1 + a.count + b.count;
    const open = Number(a.open) + Number(b.open);
    if (length >= 5) total += 10_000_000;
    else if (length === 4 && open === 2) total += 500_000;
    else if (length === 4 && open === 1) total += 85_000;
    else if (length === 3 && open === 2) total += 18_000;
    else if (length === 3 && open === 1) total += 2_200;
    else if (length === 2 && open === 2) total += 650;
    else if (length === 2 && open === 1) total += 100;
    else if (open === 2) total += 20;
  }
  return total;
}

function legalCandidates(board: Stone[][], radius = 2) {
  let occupied = false;
  for (const row of board) if (row.some(Boolean)) occupied = true;
  if (!occupied) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }
  const result: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] !== 0) continue;
      let near = false;
      for (let dr = -radius; dr <= radius && !near; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (inside(board, row + dr, col + dc) && board[row + dr][col + dc] !== 0) {
            near = true;
            break;
          }
        }
      }
      if (near) result.push({ row, col });
    }
  }
  return result;
}

function allLegalMoves(board: Stone[][]) {
  const result: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) if (board[row][col] === 0) result.push({ row, col });
  }
  return result;
}

function moveScore(board: Stone[][], row: number, col: number, player: Player) {
  const opponent: Player = player === 1 ? 2 : 1;
  const midpoint = (board.length - 1) / 2;
  const center = board.length * 2 - Math.abs(row - midpoint) - Math.abs(col - midpoint);
  return patternScore(board, row, col, player) * 1.14 + patternScore(board, row, col, opponent) + center;
}

function rankedMoves(board: Stone[][], player: Player, limit: number, radius = 2) {
  return legalCandidates(board, radius)
    .map((move) => ({ ...move, score: moveScore(board, move.row, move.col, player) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function staticEvaluation(board: Stone[][], root: Player, scoring = false) {
  const other: Player = root === 1 ? 2 : 1;
  const mine = rankedMoves(board, root, 5).reduce((sum, move, index) => sum + move.score / (index + 1), 0);
  const theirs = rankedMoves(board, other, 5).reduce((sum, move, index) => sum + move.score / (index + 1), 0);
  const lineValue = scoring ? (countFiveLines(board, root) - countFiveLines(board, other)) * 2_000_000 : 0;
  return mine - theirs * 1.05 + lineValue;
}

function minimax(board: Stone[][], depth: number, current: Player, root: Player, alpha: number, beta: number, counter: { nodes: number }, scoring = false): number {
  if (depth === 0) return staticEvaluation(board, root, scoring);
  const maximizing = current === root;
  const moves = rankedMoves(board, current, depth > 1 ? 7 : 5);
  if (moves.length === 0) return 0;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    counter.nodes += 1;
    if (!scoring && wouldWin(board, move.row, move.col, current)) return maximizing ? 100_000_000 + depth : -100_000_000 - depth;
    board[move.row][move.col] = current;
    const next: Player = current === 1 ? 2 : 1;
    const value = minimax(board, depth - 1, next, root, alpha, beta, counter, scoring);
    board[move.row][move.col] = 0;
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function chooseBuiltIn(boardInput: Stone[][], level: number, player: Player, mode: GameMode = "classic"): Decision {
  const started = performance.now();
  const board = boardInput.map((row) => [...row]);
  const opponent: Player = player === 1 ? 2 : 1;
  const counter = { nodes: 0 };
  const nearby = legalCandidates(board, level === 1 ? 1 : 2);
  let choice = nearby[0];

  if (level === 1) {
    choice = nearby[Math.floor(Math.random() * nearby.length)];
    counter.nodes = 1;
  } else {
    choice = nearby.find((move) => wouldWin(board, move.row, move.col, player)) ??
      nearby.find((move) => wouldWin(board, move.row, move.col, opponent)) ?? choice;
    counter.nodes += nearby.length;
    const forced = wouldWin(board, choice.row, choice.col, player) || wouldWin(board, choice.row, choice.col, opponent);
    if (!forced) {
      const ranked = rankedMoves(board, player, level === 2 ? 6 : 14);
      counter.nodes += ranked.length;
      if (level === 2) choice = ranked[Math.floor(Math.random() * Math.min(4, ranked.length))] ?? choice;
      if (level === 3) choice = ranked[0] ?? choice;
      if (level === 4) {
        let value = -Infinity;
        for (const move of ranked.slice(0, 10)) {
          board[move.row][move.col] = player;
          const reply = rankedMoves(board, opponent, 7)[0]?.score ?? 0;
          const score = move.score - reply * 0.94 + staticEvaluation(board, player, mode === "score9") * 0.06;
          board[move.row][move.col] = 0;
          counter.nodes += 7;
          if (score > value) { value = score; choice = move; }
        }
      }
      if (level === 5) {
        let value = -Infinity;
        for (const move of ranked.slice(0, 10)) {
          board[move.row][move.col] = player;
          const score = minimax(board, 2, opponent, player, -Infinity, Infinity, counter, mode === "score9") + move.score * 0.1;
          board[move.row][move.col] = 0;
          if (score > value) { value = score; choice = move; }
        }
      }
    }
  }

  const definition = AI_LEVELS[level - 1];
  return {
    row: choice.row,
    col: choice.col,
    telemetry: {
      nodes: counter.nodes,
      depth: definition.depth,
      elapsed: performance.now() - started,
      source: definition.method,
      move: coordinate(choice.row, choice.col, board.length),
    },
  };
}

function runCustomAi(code: string, board: Stone[][], player: Player, moves: Move[], mode: GameMode = "classic", timeout = 500): Promise<Decision> {
  const legalMoves = allLegalMoves(board);
  const state = { board, legalMoves, moveCount: moves.length, lastMove: moves.at(-1) ?? null, mode, blockedValue: 3 };
  const workerSource = `self.onmessage = (event) => {
    const started = performance.now();
    try {
      const execute = new Function("state", "me", event.data.code + "\\n;if (typeof chooseMove !== 'function') throw new Error('chooseMove 함수가 없습니다.'); return chooseMove(state, me);");
      const move = execute(event.data.state, event.data.me);
      self.postMessage({ ok: true, move, elapsed: performance.now() - started });
    } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  };`;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(url);
    const finish = () => { worker.terminate(); URL.revokeObjectURL(url); };
    const timer = window.setTimeout(() => { finish(); reject(new Error(`${timeout}ms 시간 제한을 넘었습니다.`)); }, timeout);
    worker.onmessage = (event) => {
      window.clearTimeout(timer);
      finish();
      if (!event.data.ok) { reject(new Error(event.data.error)); return; }
      const move = event.data.move;
      const legal = legalMoves.some((item) => item.row === move?.row && item.col === move?.col);
      if (!legal) { reject(new Error("합법적인 { row, col } 수를 반환하지 않았습니다.")); return; }
      resolve({ row: move.row, col: move.col, telemetry: { nodes: 1, depth: 0, elapsed: event.data.elapsed, source: "CUSTOM WORKER", move: coordinate(move.row, move.col, board.length) } });
    };
    worker.onerror = () => { window.clearTimeout(timer); finish(); reject(new Error("사용자 AI 실행 중 오류가 발생했습니다.")); };
    worker.postMessage({ code, state, me: player });
  });
}

function playerName(key: AiKey) {
  if (key === "human") return "사람";
  if (key === "custom") return "내 AI 코드";
  return AI_LEVELS[Number(key.slice(1)) - 1].name;
}

async function getDecision(key: AiKey, board: Stone[][], player: Player, moves: Move[], customCode: string, mode: GameMode) {
  if (key === "custom") return runCustomAi(customCode, board, player, moves, mode);
  return chooseBuiltIn(board, Number(key.slice(1)), player, mode);
}

export default function Home() {
  const [mode, setMode] = useState<GameMode>("classic");
  const [board, setBoard] = useState<Stone[][]>(() => createBoard("classic"));
  const [turn, setTurn] = useState<Player>(1);
  const [winner, setWinner] = useState<Winner>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [p1, setP1] = useState<AiKey>("human");
  const [p2, setP2] = useState<AiKey>("v3");
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState("흑돌을 놓으면 대국이 시작됩니다.");
  const [hint, setHint] = useState<{ row: number; col: number } | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [modalOpen, setModalOpen] = useState(false);
  const [customCode, setCustomCode] = useState(DEFAULT_CUSTOM_AI);
  const [codeStatus, setCodeStatus] = useState("코드를 수정하면 브라우저에 자동 저장됩니다.");
  const [codeStatusType, setCodeStatusType] = useState<"" | "success" | "error">("");
  const [battleOpponent, setBattleOpponent] = useState("all");
  const [battleCount, setBattleCount] = useState(2);
  const [battleRunning, setBattleRunning] = useState(false);
  const [battleProgress, setBattleProgress] = useState({ done: 0, total: 0 });
  const [battleRows, setBattleRows] = useState<BattleRow[]>([]);
  const [battleLogs, setBattleLogs] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const battleActive = useRef(false);

  const lastMove = moves.at(-1);
  const currentKey = turn === 1 ? p1 : p2;
  const currentName = playerName(currentKey);
  const battleSummary = useMemo(() => battleRows.reduce((sum, row) => ({
    wins: sum.wins + row.wins, draws: sum.draws + row.draws, losses: sum.losses + row.losses,
  }), { wins: 0, draws: 0, losses: 0 }), [battleRows]);
  const battleGames = battleSummary.wins + battleSummary.draws + battleSummary.losses;
  const liveScores = useMemo(() => ({ black: countFiveLines(board, 1), white: countFiveLines(board, 2) }), [board]);
  const openCells = useMemo(() => allLegalMoves(board).length, [board]);
  const starPoints = mode === "score9" ? SCORE_STARS : CLASSIC_STARS;

  useEffect(() => {
    const saved = window.localStorage.getItem("gomoku-arena-custom-ai");
    const timer = window.setTimeout(() => { if (saved) setCustomCode(saved); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("gomoku-arena-custom-ai", customCode);
  }, [customCode]);

  useEffect(() => {
    if (winner || currentKey === "human") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      setThinking(true);
      setNotice(`${currentName}가 수를 계산하고 있습니다.`);
      try {
        const decision = await getDecision(currentKey, board.map((row) => [...row]), turn, moves, customCode, mode);
        if (cancelled) return;
        const next = board.map((row) => [...row]);
        next[decision.row][decision.col] = turn;
        const nextMoves = [...moves, { row: decision.row, col: decision.col, player: turn }];
        setHistory((items) => [...items, { board, moves, turn }]);
        setBoard(next);
        setMoves(nextMoves);
        setHint(null);
        setTelemetry(decision.telemetry);
        if (mode === "classic" && isWinAt(next, decision.row, decision.col, turn)) {
          setWinner(turn);
          setModalOpen(true);
          setNotice(`${playerName(currentKey)} 승리 · ${decision.telemetry.move}에서 오목 완성`);
        } else if (allLegalMoves(next).length === 0) {
          const result = mode === "score9" ? scoreOutcome(next) : { black: 0, white: 0, winner: "draw" as const };
          setWinner(result.winner);
          setModalOpen(true);
          setNotice(mode === "score9" ? `빈칸이 모두 찼습니다 · 최종 점수 흑 ${result.black} : ${result.white} 백` : "모든 교차점을 두어 무승부입니다.");
        } else {
          setTurn(turn === 1 ? 2 : 1);
          const scoreText = mode === "score9" ? ` · 점수 흑 ${countFiveLines(next, 1)} : ${countFiveLines(next, 2)} 백` : "";
          setNotice(`${decision.telemetry.move}에 착수했습니다.${scoreText}`);
        }
      } catch (error) {
        if (!cancelled) {
          const other: Player = turn === 1 ? 2 : 1;
          setWinner(other);
          setModalOpen(true);
          setNotice(`${currentName} 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        if (!cancelled) setThinking(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [board, currentKey, currentName, customCode, mode, moves, turn, winner]);

  function play(row: number, col: number) {
    if (winner || thinking || currentKey !== "human" || board[row][col] !== 0) return;
    const next = board.map((line) => [...line]);
    next[row][col] = turn;
    const nextMoves = [...moves, { row, col, player: turn }];
    setHistory((items) => [...items, { board, moves, turn }]);
    setBoard(next);
    setMoves(nextMoves);
    setHint(null);
    setTelemetry({ nodes: 0, depth: 0, elapsed: 0, source: "HUMAN", move: coordinate(row, col, board.length) });
    if (mode === "classic" && isWinAt(next, row, col, turn)) {
      setWinner(turn);
      setModalOpen(true);
      setNotice(`${turn === 1 ? "흑" : "백"} 승리 · ${coordinate(row, col, board.length)}에서 오목 완성`);
    } else if (allLegalMoves(next).length === 0) {
      const result = mode === "score9" ? scoreOutcome(next) : { black: 0, white: 0, winner: "draw" as const };
      setWinner(result.winner);
      setModalOpen(true);
      setNotice(mode === "score9" ? `빈칸이 모두 찼습니다 · 최종 점수 흑 ${result.black} : ${result.white} 백` : "모든 교차점을 두어 무승부입니다.");
    } else {
      setTurn(turn === 1 ? 2 : 1);
      const scoreText = mode === "score9" ? ` · 점수 흑 ${countFiveLines(next, 1)} : ${countFiveLines(next, 2)} 백` : "";
      setNotice(`${coordinate(row, col, board.length)}에 착수했습니다.${scoreText}`);
    }
  }

  function resetGame(targetMode: GameMode = mode) {
    setBoard(createBoard(targetMode)); setTurn(1); setWinner(null); setMoves([]); setHistory([]);
    setHint(null); setTelemetry(EMPTY_TELEMETRY); setModalOpen(false); setThinking(false);
    setNotice(targetMode === "score9" ? "장애물·흑돌·백돌이 각각 8칸 배치되었습니다. 빈칸이 없어질 때까지 점수를 만드세요." : "흑돌을 놓으면 대국이 시작됩니다.");
  }

  function undo() {
    const snapshot = history.at(-1);
    if (!snapshot) return;
    setBoard(snapshot.board); setMoves(snapshot.moves); setTurn(snapshot.turn);
    setHistory(history.slice(0, -1)); setWinner(null); setModalOpen(false); setHint(null);
    setNotice("직전 수를 취소했습니다.");
  }

  function analyzeHint() {
    if (winner) return;
    const decision = chooseBuiltIn(board, 5, turn, mode);
    setHint({ row: decision.row, col: decision.col });
    setTelemetry(decision.telemetry);
    setNotice(`추천 수는 ${decision.telemetry.move}입니다. v5가 ${decision.telemetry.nodes.toLocaleString()}개 노드를 확인했습니다.`);
  }

  function autoPlay() {
    setP1("v3"); setP2("v5"); resetGame();
    setNotice("v3 형태 평가와 v5 심화 탐색의 자동 대국을 시작합니다.");
  }

  async function testCustomCode() {
    setCodeStatusType(""); setCodeStatus("초기 국면에서 코드를 검증하고 있습니다.");
    try {
      const decision = await runCustomAi(customCode, emptyBoard(), 1, []);
      setCodeStatusType("success");
      setCodeStatus(`검증 통과 · ${decision.telemetry.move} 반환 · ${decision.telemetry.elapsed.toFixed(1)}ms`);
    } catch (error) {
      setCodeStatusType("error");
      setCodeStatus(`검증 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024) { setCodeStatusType("error"); setCodeStatus("50KB 이하 파일만 불러올 수 있습니다."); return; }
    const reader = new FileReader();
    reader.onload = () => { setCustomCode(String(reader.result)); setCodeStatusType("success"); setCodeStatus(`${file.name}을 불러왔습니다.`); };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function copySpec() {
    const spec = `오목 AI 함수를 작성해 주세요.\nfunction chooseMove(state, me)\n- me: 1(흑) 또는 2(백)\n- state.mode: classic 또는 score9\n- state.board: 15x15 또는 9x9 배열, 0 빈칸 / 1 흑 / 2 백 / 3 장애물\n- state.legalMoves: 반환 가능한 { row, col } 배열\n- state.moveCount, state.lastMove 제공\n- score9: 빈칸이 없을 때 종료, 완성된 5칸 구간 수로 득점\n- 제한: 한 수 500ms, 파일 50KB\n- 반환: state.legalMoves에 있는 { row, col } 하나`;
    await navigator.clipboard.writeText(spec);
    setCodeStatusType("success"); setCodeStatus("LLM용 오목 AI 규격을 복사했습니다.");
  }

  async function simulateBattle(level: number, customPlayer: Player) {
    const simBoard = createBoard(mode);
    const simMoves: Move[] = [];
    let simTurn: Player = 1;
    let error = "";
    for (let ply = 0; ply < 120; ply += 1) {
      if (!battleActive.current) return { winner: "stopped" as const, error, log: "" };
      let decision: Decision;
      try {
        decision = simTurn === customPlayer
          ? await runCustomAi(customCode, simBoard.map((row) => [...row]), simTurn, simMoves, mode)
          : chooseBuiltIn(simBoard, level, simTurn, mode);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        return { winner: (simTurn === 1 ? 2 : 1) as Player, error, log: `AI 오류: ${error}` };
      }
      simBoard[decision.row][decision.col] = simTurn;
      simMoves.push({ row: decision.row, col: decision.col, player: simTurn });
      if (mode === "classic" && isWinAt(simBoard, decision.row, decision.col, simTurn)) {
        return { winner: simTurn as Winner, error, log: simMoves.map((move, index) => `${index + 1}.${move.player === 1 ? "B" : "W"}:${coordinate(move.row, move.col, simBoard.length)}`).join(" ") };
      }
      if (allLegalMoves(simBoard).length === 0) {
        if (mode === "score9") {
          const result = scoreOutcome(simBoard);
          return { winner: result.winner, error, log: `최종 점수 흑 ${result.black} : ${result.white} 백` };
        }
        return { winner: "draw" as const, error, log: "모든 교차점을 둔 무승부" };
      }
      simTurn = simTurn === 1 ? 2 : 1;
    }
    return { winner: "draw" as const, error, log: "120수 제한 무승부" };
  }

  async function runBattle() {
    const levels = battleOpponent === "all" ? [1, 2, 3, 4, 5] : [Number(battleOpponent)];
    const total = levels.length * battleCount;
    const rows = levels.map((level) => ({ level, wins: 0, draws: 0, losses: 0, errors: 0 }));
    setBattleRows(rows); setBattleLogs([]); setBattleProgress({ done: 0, total }); setBattleRunning(true);
    battleActive.current = true;
    let done = 0;
    const logs: string[] = [];
    for (let levelIndex = 0; levelIndex < levels.length && battleActive.current; levelIndex += 1) {
      for (let game = 0; game < battleCount && battleActive.current; game += 1) {
        const customPlayer: Player = game % 2 === 0 ? 1 : 2;
        const result = await simulateBattle(levels[levelIndex], customPlayer);
        if (result.winner === "stopped") break;
        if (result.error) rows[levelIndex].errors += 1;
        if (result.winner === "draw") rows[levelIndex].draws += 1;
        else if (result.winner === customPlayer) rows[levelIndex].wins += 1;
        else rows[levelIndex].losses += 1;
        done += 1;
        logs.unshift(`vs v${levels[levelIndex]} · ${game + 1}경기 · 내 AI ${customPlayer === 1 ? "흑" : "백"} · ${result.winner === "draw" ? "무승부" : result.winner === customPlayer ? "승리" : "패배"}\n${result.log}`);
        setBattleRows(rows.map((row) => ({ ...row })));
        setBattleLogs([...logs]);
        setBattleProgress({ done, total });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    battleActive.current = false;
    setBattleRunning(false);
  }

  function stopBattle() {
    battleActive.current = false;
    setBattleRunning(false);
  }

  const status = winner === "draw" ? "무승부" : winner ? `${winner === 1 ? "흑" : "백"} 승리` : thinking ? `${currentName} 생각 중` : `${currentName} 차례 · ${turn === 1 ? "흑" : "백"}`;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">GOMOKU · SEARCH LAB</p>
          <h1>한 줄의 승부, <span>끝까지 읽는 AI.</span></h1>
          <p className="hero-copy">15×15 기본 오목과 장애물·선배치 돌이 있는 9×9 랜덤 스코어 오목에서, 무작위 v1부터 알파베타 v5까지 직접 대국하고 내 JavaScript AI를 비교하세요.</p>
        </div>
        <div className="hero-badge"><b>5</b><span>AI LEVELS</span></div>
      </header>

      <section className="workspace">
        <article className="board-panel panel">
          <div className="panel-head">
            <div><span className="step">01 · PLAYGROUND</span><h2>대국 보드</h2></div>
            <div className={`turn-pill ${thinking ? "thinking" : ""}`}>{status}</div>
          </div>

          <div className="game-mode-switch" role="radiogroup" aria-label="게임 규칙 선택">
            <button type="button" role="radio" aria-checked={mode === "classic"} className={mode === "classic" ? "active" : ""} onClick={() => { setMode("classic"); resetGame("classic"); }}><b>기본 오목 · 15×15</b><small>5개를 먼저 연결하면 승리</small></button>
            <button type="button" role="radio" aria-checked={mode === "score9"} className={mode === "score9" ? "active" : ""} onClick={() => { setMode("score9"); resetGame("score9"); }}><b>랜덤 스코어 · 9×9</b><small>빈칸 종료 · 완성한 5칸 구간 득점</small></button>
          </div>

          <div className="player-strip opponent-strip">
            <div className="stone-avatar white">W</div>
            <div><b>{playerName(p2)}</b><small>백 · 후공</small></div>
            {mode === "score9" && <strong className="score-chip">{liveScores.white}점</strong>}
            <span className={turn === 2 && !winner ? "player-live" : "player-dot"} />
          </div>

          {mode === "score9" && <div className="variant-scoreboard" aria-label={`현재 점수 흑 ${liveScores.black}점, 백 ${liveScores.white}점, 빈칸 ${openCells}개`}><span>흑 <b>{liveScores.black}</b></span><i>현재 점수</i><span>백 <b>{liveScores.white}</b></span><small>남은 빈칸 {openCells}</small></div>}

          <div className="board-wrap">
            <div className="file-labels" style={{ gridTemplateColumns: `repeat(${board.length}, 1fr)` }}>{COLS.slice(0, board.length).split("").map((label) => <span key={label}>{label}</span>)}</div>
            <div className="rank-labels" style={{ gridTemplateRows: `repeat(${board.length}, 1fr)` }}>{Array.from({ length: board.length }, (_, index) => <span key={index}>{board.length - index}</span>)}</div>
            <div className={`arena-board ${mode === "score9" ? "score-board" : ""}`} style={{ gridTemplateColumns: `repeat(${board.length}, 1fr)`, gridTemplateRows: `repeat(${board.length}, 1fr)` }} aria-label={`${board.length}x${board.length} 오목판`}>
              {board.map((row, rowIndex) => row.map((stone, colIndex) => {
                const last = lastMove?.row === rowIndex && lastMove?.col === colIndex;
                const recommended = hint?.row === rowIndex && hint?.col === colIndex;
                return (
                  <button
                    type="button"
                    key={`${rowIndex}-${colIndex}`}
                    className={`intersection ${stone === 3 ? "blocked" : ""} ${last ? "last" : ""} ${recommended ? "recommended" : ""}`}
                    onClick={() => play(rowIndex, colIndex)}
                    disabled={stone !== 0 || Boolean(winner) || thinking || currentKey !== "human"}
                    aria-label={`${coordinate(rowIndex, colIndex, board.length)}${stone === 1 ? " 흑돌" : stone === 2 ? " 백돌" : stone === 3 ? " 장애물, 착수 불가" : " 빈칸"}`}
                  >
                    {(stone === 1 || stone === 2) && <span className={`board-stone ${stone === 1 ? "black" : "white"}`} />}
                    {stone === 3 && <span className="blocked-cell" aria-hidden="true">×</span>}
                    {stone === 0 && starPoints.has(`${rowIndex}-${colIndex}`) && <span className="star" />}
                  </button>
                );
              }))}
            </div>
          </div>

          <div className="player-strip">
            <div className="stone-avatar black">B</div>
            <div><b>{playerName(p1)}</b><small>흑 · 선공</small></div>
            {mode === "score9" && <strong className="score-chip">{liveScores.black}점</strong>}
            <span className={turn === 1 && !winner ? "player-live" : "player-dot"} />
          </div>

          <div className="board-actions">
            <button type="button" className="primary" onClick={() => resetGame()}>새 대국</button>
            <button type="button" onClick={undo} disabled={!history.length || thinking}>한 수 취소</button>
            <button type="button" onClick={analyzeHint} disabled={Boolean(winner) || thinking}>추천 수 분석</button>
            <button type="button" onClick={autoPlay}>AI끼리 1판</button>
          </div>
          <p className="game-status" aria-live="polite">{notice}</p>
        </article>
      </section>

      <section className="code-arena panel">
        <div className="section-title code-arena-title">
          <div><span className="step">02 · AI CODE ARENA</span><h2>내 AI 코드로 예제 AI와 대전</h2></div>
          <p><code>chooseMove(state, me)</code>를 작성하고 v1~v5를 상대로 흑·백을 번갈아 실력을 측정합니다.</p>
        </div>
        <div className="code-arena-grid">
          <article className="editor-card">
            <div className="editor-toolbar"><div><span className="editor-dot" /><b>my-gomoku-ai.js</b></div><span>JavaScript · 50KB · 500ms/수</span></div>
            <textarea className="code-editor" value={customCode} onChange={(event) => setCustomCode(event.target.value)} spellCheck={false} aria-label="내 오목 AI JavaScript 코드" />
            <div className="editor-actions">
              <input ref={fileInput} type="file" accept=".js,.txt,text/javascript,text/plain" hidden onChange={loadFile} />
              <div className="editor-file-actions">
                <button type="button" onClick={() => fileInput.current?.click()}>AI 파일 불러오기</button>
                <button type="button" onClick={() => setCustomCode(DEFAULT_CUSTOM_AI)}>예제 복원</button>
                <button type="button" onClick={copySpec}>LLM용 규격 복사</button>
              </div>
              <div className="editor-run-actions">
                <button type="button" onClick={testCustomCode}>코드 1수 검증</button>
                <button type="button" className="primary" onClick={runBattle} disabled={battleRunning}>대전 시작</button>
                <button type="button" onClick={stopBattle} disabled={!battleRunning}>중지</button>
              </div>
            </div>
            <p className={`code-status ${codeStatusType}`}>{codeStatus}</p>
          </article>

          <article className="battle-card">
            <div className="battle-heading"><div><span className="step">BENCHMARK MATCH</span><h3>성능별 대전</h3></div><span className="sandbox-chip">WORKER SANDBOX</span></div>
            <div className="battle-options">
              <label>상대 AI<select value={battleOpponent} onChange={(event) => setBattleOpponent(event.target.value)} disabled={battleRunning}><option value="all">v1~v5 전체 비교</option>{AI_LEVELS.map((ai) => <option key={ai.level} value={ai.level}>{ai.name}</option>)}</select></label>
              <label>AI별 경기 수<select value={battleCount} onChange={(event) => setBattleCount(Number(event.target.value))} disabled={battleRunning}><option>2</option><option>4</option><option>10</option></select></label>
            </div>
            <div className="battle-score">
              <div><span>승</span><b>{battleSummary.wins}</b></div><div><span>무</span><b>{battleSummary.draws}</b></div><div><span>패</span><b>{battleSummary.losses}</b></div><div><span>승률</span><b>{battleGames ? Math.round(battleSummary.wins / battleGames * 100) : 0}%</b></div>
            </div>
            <div className="battle-progress"><div><span>{battleRunning ? "대전 진행 중" : battleProgress.done ? "대전 완료" : "대기 중"}</span><span>{battleProgress.done} / {battleProgress.total}</span></div><i><b style={{ width: `${battleProgress.total ? battleProgress.done / battleProgress.total * 100 : 0}%` }} /></i></div>
            <div className="battle-table-wrap"><table className="battle-table"><thead><tr><th>상대</th><th>승</th><th>무</th><th>패</th><th>승률</th><th>오류</th></tr></thead><tbody>{battleRows.length ? battleRows.map((row) => { const count = row.wins + row.draws + row.losses; return <tr key={row.level}><td>v{row.level}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{count ? Math.round(row.wins / count * 100) : 0}%</td><td>{row.errors}</td></tr>; }) : <tr><td colSpan={6}>대전을 시작하면 결과가 표시됩니다.</td></tr>}</tbody></table></div>
            <p className="battle-note">현재 선택한 {mode === "score9" ? "9×9 랜덤 스코어" : "15×15 기본 오목"} 규칙으로 대전합니다. 상대마다 내 AI의 흑과 백 경기 수를 동일하게 배정합니다.</p>
            <section className="match-logs"><div className="match-logs-title"><b>경기별 로그</b><span>최근 경기 우선</span></div><div className="match-log-list">{battleLogs.length ? battleLogs.map((log, index) => <details className="match-log-item" key={`${index}-${log.slice(0, 12)}`}><summary>{log.split("\n")[0]}</summary><pre>{log}</pre></details>) : <p className="match-log-empty">대전을 완료하면 경기별 로그가 표시됩니다.</p>}</div></section>
          </article>
        </div>
        <details className="api-contract"><summary>AI 함수 입력·출력 규격 보기</summary><div className="contract-grid"><div><b>입력</b><pre>{`function chooseMove(state, me)\n\nstate.mode        // classic | score9\nstate.board       // 15×15 또는 9×9 배열\n                  // 0 빈칸 | 1 흑 | 2 백 | 3 장애물\nstate.legalMoves  // 가능한 {row,col}\nstate.moveCount   // 현재 수\nstate.lastMove    // 직전 수\nme                // 1 흑 | 2 백`}</pre></div><div><b>반환</b><pre>{`{ row: 7, col: 7 }`}</pre><p>반드시 <code>state.legalMoves</code>에 들어 있는 수 하나를 반환하세요. <code>score9</code>에서는 5칸 구간을 많이 완성할수록 유리합니다.</p></div></div></details>
      </section>

      <section className="post-arena-layout">
        <details className="advanced-tools panel" open>
          <summary><span><b>03–04 · MATCH SETUP / TELEMETRY</b><strong>대국 설정·탐색 정보 보기</strong></span><small>선수와 마지막 탐색을 확인하세요</small></summary>
          <div className="advanced-tools-grid">
            <section className="settings-panel"><div className="panel-head compact"><div><span className="step">03 · MATCH SETUP</span><h2>선수 설정</h2></div></div><div className="select-grid"><label>P1 · 흑 · 선공<select value={p1} onChange={(event) => { setP1(event.target.value as AiKey); resetGame(); }}>{["human", ...AI_LEVELS.map((ai) => ai.key), "custom"].map((key) => <option key={key} value={key}>{playerName(key as AiKey)}</option>)}</select></label><label>P2 · 백 · 후공<select value={p2} onChange={(event) => { setP2(event.target.value as AiKey); resetGame(); }}>{["human", ...AI_LEVELS.map((ai) => ai.key), "custom"].map((key) => <option key={key} value={key}>{playerName(key as AiKey)}</option>)}</select></label></div><div className="level-detail">선수 변경은 새 대국에 즉시 적용됩니다. 사람끼리, 사람 대 AI, AI 대 AI, 내 코드 대 예제 AI 조합을 모두 지원합니다.</div></section>
            <section className="telemetry-panel"><div className="panel-head compact"><div><span className="step">04 · TELEMETRY</span><h2>마지막 탐색</h2></div><span className="exact-chip">{telemetry.source}</span></div><div className="metrics"><div><span>탐색 노드</span><b>{telemetry.nodes.toLocaleString()}</b></div><div><span>완료 깊이</span><b>{telemetry.depth}</b></div><div><span>생각 시간</span><b>{telemetry.elapsed.toFixed(1)} ms</b></div><div><span>진행 수</span><b>{moves.length}</b></div></div><div className="analysis-line"><span>선택한 수</span><strong>{telemetry.move}</strong></div></section>
          </div>
        </details>
        <section className="panel record-panel"><div className="panel-head compact"><div><span className="step">05 · GAME LOG</span><h2>기보</h2></div><button type="button" className="text-button" onClick={() => resetGame()}>지우기</button></div><ol className="move-log">{moves.length ? moves.map((move, index) => <li key={`${index}-${move.row}-${move.col}`}>{index + 1}. {move.player === 1 ? "B" : "W"} {coordinate(move.row, move.col, board.length)}</li>) : <li className="empty">아직 둔 수가 없습니다.</li>}</ol></section>
      </section>

      <section className="levels-section">
        <div className="section-title"><div><span className="step">AI EVOLUTION</span><h2>성능별 예제 AI v1 → v5</h2></div><p>각 단계는 앞 단계의 판단을 유지하면서 전술, 형태 평가, 수읽기를 차례로 추가합니다.</p></div>
        <div className="level-cards">{AI_LEVELS.map((ai) => <article className={`level-card ${p2 === ai.key ? "active" : ""}`} data-version={`V${ai.level}`} key={ai.level}><span className="bar" style={{ width: `${ai.power}%` }} /><b>{ai.name}</b><small>{ai.method}</small><p>{ai.description}</p></article>)}</div>
      </section>

      <section className="rules panel"><div className="section-title"><div><span className="step">RULEBOOK</span><h2>두 가지 예제 게임 규칙</h2></div></div><div className="rule-list"><p><b>기본 · 15×15</b>가로·세로·대각선으로 같은 돌 5개 이상을 먼저 연결하면 즉시 승리합니다.</p><p><b>랜덤 · 9×9</b>시작할 때 착수 불가 장애물, 흑돌, 백돌을 겹치지 않게 각각 8칸(보드의 약 10%) 무작위 배치합니다.</p><p><b>스코어 종료</b>5개가 연결되어도 계속 두며, 모든 빈칸이 찬 뒤 완성된 연속 5칸 구간 수가 더 많은 쪽이 승리합니다.</p><p><b>중첩 득점</b>한 방향의 6목은 서로 겹치는 5칸 구간이 2개이므로 2점입니다. 가로·세로·두 대각선을 각각 셉니다.</p><p><b>공통</b>흑부터 번갈아 빈 교차점에 두며, 사용자 AI는 별도 Worker에서 한 수당 500ms 제한으로 실행됩니다.</p></div></section>

      {modalOpen && winner && <div className="result-modal"><div className="result-card" role="dialog" aria-modal="true" aria-labelledby="resultTitle"><span>GAME OVER</span><h2 id="resultTitle">{winner === "draw" ? "무승부" : `${winner === 1 ? "흑" : "백"} 승리`}</h2><p>{notice}</p><button type="button" className="primary" onClick={() => resetGame()}>새 대국 시작</button><button type="button" onClick={() => setModalOpen(false)}>기보 계속 보기</button></div></div>}
    </main>
  );
}
