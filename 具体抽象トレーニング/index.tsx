
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
type Difficulty = '初級' | '普通' | '上級' | 'エキスパート';
type Phase = 'HOME' | 'GAME_CONFIG' | 'PLAYER_INPUT' | 'ORDER_SELECT' | 'PLAYING' | 'EVALUATION' | 'FINAL_RESULT' | 'BRAINSTORM' | 'EXPLANATION';
type Theme = 'dark' | 'light';

interface Player {
  name: string;
  score: number;
}

interface Note {
  id: string;
  text: string;
  abstraction: number; // 0 (具体: 緑) to 100 (抽象: 赤)
  x: number;
  y: number;
}

const CANVAS_SIZE = 5000; // 5000px x 5000px

const DIFFICULTY_CONFIG: Record<Difficulty, { clues: number; type: 'word' | 'sentence' }> = {
  '初級': { clues: 2, type: 'word' },
  '普通': { clues: 3, type: 'word' },
  '上級': { clues: 3, type: 'sentence' },
  'エキスパート': { clues: 4, type: 'sentence' },
};

const EVALUATION_LEVELS = [
  { rating: 5, label: '完璧！', points: 100, color: 'text-emerald-400', icon: '💎' },
  { rating: 4, label: 'お見事！', points: 80, color: 'text-teal-400', icon: '✨' },
  { rating: 3, label: '惜しい！', points: 60, color: 'text-yellow-400', icon: '⭐' },
  { rating: 2, label: 'まずまず', points: 40, color: 'text-orange-400', icon: '📝' },
  { rating: 1, label: '残念...', points: 0, color: 'text-rose-400', icon: '❓' },
];

// --- App Component ---
const WordWeaver: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('HOME');
  const [difficulty, setDifficulty] = useState<Difficulty>('普通');
  const [theme, setTheme] = useState<Theme>('dark');
  const [totalRounds, setTotalRounds] = useState(3);
  const [players, setPlayers] = useState<Player[]>([{ name: '', score: 0 }, { name: '', score: 0 }]);
  const [usedWords, setUsedWords] = useState<string[]>([]);
  
  const [currentRound, setCurrentRound] = useState(1);
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  
  // Game Content
  const [secretWord, setSecretWord] = useState('');
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [expertLogic, setExpertLogic] = useState('');
  const [clues, setClues] = useState<string[]>([]);
  
  const [userGuess, setUserGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<{ score: number; feedback: string; rating: number } | null>(null);

  // Brainstorm state
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteAbstraction, setNewNoteAbstraction] = useState(50);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0, noteX: 0, noteY: 0 });
  const [showInput, setShowInput] = useState(true);
  const [zoom, setZoom] = useState(1.0);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const inputRef = useRef<HTMLInputElement>(null);

  // Theme helper classes
  const t = {
    bg: theme === 'dark' ? 'bg-[#020617]' : 'bg-[#f8fafc]',
    container: theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200 shadow-2xl',
    text: theme === 'dark' ? 'text-slate-100' : 'text-slate-900',
    textMuted: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    card: theme === 'dark' ? 'bg-slate-800/30 border-slate-800' : 'bg-slate-50 border-slate-200',
    input: theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200',
    buttonMuted: theme === 'dark' ? 'bg-slate-800/50 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-600',
  };

  // Initial scroll to center for brainstorm
  useEffect(() => {
    if (phase === 'BRAINSTORM' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = (CANVAS_SIZE * zoom) / 2 - window.innerWidth / 2;
      scrollContainerRef.current.scrollTop = (CANVAS_SIZE * zoom) / 2 - window.innerHeight / 2;
    }
  }, [phase]);

  // --- Drag & Drop Handlers ---
  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    setDraggingId(id);
    setDragStartPos({
      x: e.clientX,
      y: e.clientY,
      noteX: note.x,
      noteY: note.y
    });
    e.stopPropagation();
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingId) return;
    const dx = (e.clientX - dragStartPos.x) / zoom;
    const dy = (e.clientY - dragStartPos.y) / zoom;
    
    setNotes(prev => prev.map(n => 
      n.id === draggingId 
        ? { ...n, x: dragStartPos.noteX + dx, y: dragStartPos.noteY + dy } 
        : n
    ));
  }, [draggingId, dragStartPos, zoom]);

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  useEffect(() => {
    if (draggingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, handleMouseMove, handleMouseUp]);

  // --- Handlers ---
  const resetGame = () => {
    setPhase('HOME');
    setPlayers([{ name: '', score: 0 }, { name: '', score: 0 }]);
    setUsedWords([]);
    setCurrentRound(1);
    setCurrentPlayerIdx(0);
    setNotes([]);
    setZoom(1.0);
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const startOrderSelection = () => {
    const validPlayers = players.map((p, i) => ({
      ...p,
      name: p.name.trim() || `プレイヤー ${i + 1}`
    }));
    setPlayers(validPlayers);
    setPhase('ORDER_SELECT');
  };

  const startPlaying = async () => {
    setCurrentRound(1);
    setCurrentPlayerIdx(0);
    setPhase('PLAYING');
    await fetchNextTurn();
  };

  const fetchNextTurn = async () => {
    setLoading(true);
    setUserGuess('');
    setEvaluation(null);
    setAlternatives([]);
    setExpertLogic('');
    
    try {
      const config = DIFFICULTY_CONFIG[difficulty];
      let difficultyPrompt = "";
      
      if (difficulty === '初級') {
        difficultyPrompt = `指示: 誰もが知っている非常に具体的な「名詞」を正解にしてください。専門用語、業界用語、学術用語は一切禁止です。子供でも理解できる言葉に限定してください。`;
      } else if (difficulty === '普通') {
        difficultyPrompt = `指示: 少しだけ抽象的な概念（「信頼」「努力」など）を正解にしてください。答えは1〜2個程度です。`;
      } else if (difficulty === '上級') {
        difficultyPrompt = `指示: 比較的抽象度の高い概念を正解にしてください。答えの方向性が複数あるものを想定し、別解リスト(alternatives)も作成してください。`;
      } else if (difficulty === 'エキスパート') {
        difficultyPrompt = `指示: AIでも答えを断定できない、または解釈が無限に広がる超抽象적・哲学的なテーマを正解にしてください。具体的な答えではなく、考察のための思考法をexpertLogicに記述してください。`;
      }

      const prompt = `日本語の連想ゲーム問題を1つ生成してください。
1. 10万語規模の語彙から [${usedWords.join(', ')}] 以外の単語をランダムに選びます。
2. ヒントを${config.clues}個生成してください。形式は${config.type === 'word' ? '単語' : '文章'}です。
3. ${difficultyPrompt}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              secret: { type: Type.STRING },
              clues: { type: Type.ARRAY, items: { type: Type.STRING } },
              alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
              expertLogic: { type: Type.STRING },
            },
            required: ["secret", "clues"],
          },
        },
      });
      const data = JSON.parse(response.text || '{}');
      setSecretWord(data.secret);
      setClues(data.clues);
      setAlternatives(data.alternatives || []);
      setExpertLogic(data.expertLogic || '');
      setUsedWords(prev => [...prev, data.secret]);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const handleGuess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userGuess.trim() || loading) return;

    if (difficulty === '初級') {
      setLoading(true);
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `正解:「${secretWord}」、回答:「${userGuess}」。1-5で採点し、日本語のFBをください。`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rating: { type: Type.INTEGER },
                feedback: { type: Type.STRING }
              },
              required: ["rating", "feedback"]
            }
          }
        });
        const result = JSON.parse(response.text || '{"rating": 1, "feedback": "判定不能"}');
        const points = [0, 0, 40, 60, 80, 100][result.rating] || 0;
        setEvaluation({ score: points, feedback: result.feedback, rating: result.rating });
        updateScore(points);
        setPhase('EVALUATION');
      } catch (err) { console.error(err); } finally { setLoading(false); }
    } else {
      setPhase('EVALUATION');
    }
  };

  const handleManualRating = (rating: number) => {
    const points = [0, 0, 40, 60, 80, 100][rating] || 0;
    setEvaluation({ score: points, feedback: "他プレイヤーによる判定です。", rating: rating });
    updateScore(points);
  };

  const handlePass = () => {
    const currentPlayer = players[currentPlayerIdx];
    let penalty = 0;
    let feedback = "";

    if (currentPlayer.score > 0) {
      const reduction = Math.floor(currentPlayer.score / 2);
      penalty = -reduction;
      feedback = `パスを選択しました。点数が半分になりました。正解は「${secretWord}」でした。`;
    } else {
      const othersTotal = players.reduce((sum, p, idx) => 
        idx === currentPlayerIdx ? sum : sum + Math.max(0, p.score), 0);
      penalty = -othersTotal;
      feedback = `点数が0以下のため、他プレイヤーの合計点 (${othersTotal}pt) がペナルティとなりました。正解は「${secretWord}」でした。`;
    }

    updateScore(penalty);
    setEvaluation({ score: penalty, feedback: feedback, rating: 1 });
    setPhase('EVALUATION');
  };

  const updateScore = (points: number) => {
    const newPlayers = [...players];
    newPlayers[currentPlayerIdx].score += points;
    setPlayers(newPlayers);
  };

  const nextTurn = () => {
    if (currentPlayerIdx < players.length - 1) {
      setCurrentPlayerIdx(p => p + 1);
      setPhase('PLAYING');
      fetchNextTurn();
    } else if (currentRound < totalRounds) {
      setCurrentRound(r => r + 1);
      setCurrentPlayerIdx(0);
      setPhase('PLAYING');
      fetchNextTurn();
    } else {
      setPhase('FINAL_RESULT');
    }
  };

  const addNote = () => {
    if (!newNoteText.trim()) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const centerX = (container.scrollLeft + window.innerWidth / 2) / zoom;
    const centerY = (container.scrollTop + window.innerHeight / 2) / zoom;

    const note: Note = {
      id: Math.random().toString(36).substr(2, 9),
      text: newNoteText,
      abstraction: newNoteAbstraction,
      x: centerX - 100 + (Math.random() - 0.5) * 40,
      y: centerY - 50 + (Math.random() - 0.5) * 40
    };
    setNotes([note, ...notes]);
    setNewNoteText('');
  };

  const getNoteColor = (abs: number) => {
    if (abs <= 50) {
      const f = abs / 50;
      const r = Math.floor(16 + (245 - 16) * f);
      const g = Math.floor(185 + (158 - 185) * f);
      const b = Math.floor(129 + (11 - 129) * f);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const f = (abs - 50) / 50;
      const r = Math.floor(245 + (244 - 245) * f);
      const g = Math.floor(158 + (63 - 158) * f);
      const b = Math.floor(11 + (94 - 11) * f);
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  const changeZoom = (delta: number) => {
    setZoom(prev => Math.min(2.0, Math.max(0.2, prev + delta)));
  };

  // --- Renders ---
  const renderHome = () => (
    <div className="flex flex-col gap-4 animate-in">
      <button onClick={() => setPhase('GAME_CONFIG')} className={`group p-8 ${theme === 'dark' ? 'bg-indigo-600/20 hover:bg-indigo-600/40 border-indigo-500/50' : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200'} border rounded-3xl transition-all text-left`}>
        <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} mb-2`}>ゲームで遊ぶ</h3>
        <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} font-medium leading-relaxed`}>具体から超抽象まで。AIが生成する「問い」に対して思考を巡らせる連想ゲーム。</p>
      </button>
      <button onClick={() => setPhase('BRAINSTORM')} className={`group p-8 ${theme === 'dark' ? 'bg-teal-600/20 hover:bg-teal-600/40 border-teal-500/50' : 'bg-teal-50 hover:bg-teal-100 border-teal-200'} border rounded-3xl transition-all text-left`}>
        <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-teal-400' : 'text-teal-600'} mb-2`}>思考キャンバス</h3>
        <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} font-medium leading-relaxed`}>広大な5000pxの空間で自由に付箋を動かし思考を整理。ズーム機能で全体像を把握。</p>
      </button>
      <button onClick={() => setPhase('EXPLANATION')} className={`group p-8 ${t.buttonMuted} border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} rounded-3xl transition-all text-left`}>
        <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} mb-2`}>思考法の解説</h3>
        <p className={`text-sm ${t.textMuted} font-medium leading-relaxed`}>なぜ「抽象化」が必要なのか？ ビジネスや日常生活に役立つ思考の武器を解説。</p>
      </button>
    </div>
  );

  const renderBrainstorm = () => (
    <div className={`animate-in h-screen w-full fixed inset-0 overflow-hidden ${t.bg}`}>
      <div 
        ref={scrollContainerRef}
        className="w-full h-full overflow-auto custom-scrollbar-wide"
      >
        <div 
          className="relative transition-all duration-300 ease-out"
          style={{ width: CANVAS_SIZE * zoom, height: CANVAS_SIZE * zoom }}
        >
          <div 
            style={{ 
              transform: `scale(${zoom})`, 
              transformOrigin: '0 0', 
              width: CANVAS_SIZE, 
              height: CANVAS_SIZE,
              backgroundImage: theme === 'dark' 
                ? 'radial-gradient(circle, #1e293b 1px, transparent 1px)' 
                : 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
              backgroundSize: '40px 40px'
            }}
            className={`absolute top-0 left-0 ${theme === 'dark' ? 'bg-slate-950/20' : 'bg-white'}`}
          >
            {notes.map((note) => (
              <div
                key={note.id}
                onMouseDown={(e) => handleMouseDown(e, note.id)}
                style={{
                  left: note.x,
                  top: note.y,
                  backgroundColor: getNoteColor(note.abstraction),
                  cursor: draggingId === note.id ? 'grabbing' : 'grab',
                  zIndex: draggingId === note.id ? 90 : 10,
                  transform: draggingId === note.id ? 'scale(1.05)' : 'scale(1)',
                  position: 'absolute'
                }}
                className="p-5 rounded-2xl shadow-xl min-w-[180px] max-w-[280px] border border-white/20 backdrop-blur-sm select-none transition-transform duration-200"
              >
                <p className="text-sm font-bold leading-relaxed text-white drop-shadow-md">{note.text}</p>
                <div className="mt-2 text-[8px] font-black text-white/50 uppercase flex justify-between">
                  <span>{note.abstraction}%</span>
                  <span>{note.abstraction < 30 ? '具体' : note.abstraction > 70 ? '抽象' : '中間'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="fixed top-8 left-0 right-0 text-center pointer-events-none z-50">
        <h2 className={`text-2xl font-black ${theme === 'dark' ? 'text-teal-400' : 'text-teal-600'} mb-1 drop-shadow-lg`}>思考のキャンバス</h2>
        <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-500 bg-slate-900/40' : 'text-slate-400 bg-white/80'} font-bold uppercase tracking-widest inline-block px-4 py-1 rounded-full backdrop-blur-sm shadow-sm`}>
          ズーム: {Math.round(zoom * 100)}%
        </p>
      </div>

      <button onClick={() => setPhase('HOME')} className={`fixed top-8 left-8 p-4 ${theme === 'dark' ? 'bg-slate-900/80' : 'bg-white/80 shadow-lg'} hover:opacity-80 rounded-full text-slate-400 transition-all border ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'} z-[101]`}>🏠</button>

      {/* Zoom Controls */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-2 z-[101]">
        <button onClick={() => changeZoom(0.1)} className={`w-12 h-12 ${t.buttonMuted} border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} rounded-xl font-black text-2xl shadow-2xl flex items-center justify-center`}>+</button>
        <button onClick={() => setZoom(1.0)} className={`w-12 h-12 ${t.buttonMuted} border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} rounded-xl font-black text-xs shadow-2xl flex items-center justify-center`}>1:1</button>
        <button onClick={() => changeZoom(-0.1)} className={`w-12 h-12 ${t.buttonMuted} border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} rounded-xl font-black text-2xl shadow-2xl flex items-center justify-center`}>-</button>
      </div>

      {/* Floating Input Panel */}
      <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 transition-all duration-500 z-[100] ${showInput ? 'translate-y-0' : 'translate-y-[85%]'}`}>
        <div className={`${theme === 'dark' ? 'bg-slate-900/90' : 'bg-white/95'} backdrop-blur-xl p-6 rounded-[2.5rem] border ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'} shadow-2xl relative`}>
          <button onClick={() => setShowInput(!showInput)} className={`absolute -top-4 left-1/2 -translate-x-1/2 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-200 border-white'} w-12 h-8 rounded-t-xl flex items-center justify-center text-slate-400 hover:text-indigo-500 transition-colors pointer-events-auto`}>
            {showInput ? '▼' : '▲'}
          </button>
          
          <div className="flex flex-col gap-4">
            <textarea
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              placeholder="アイディアを入力してキャンバスへ飛ばそう..."
              className={`w-full h-24 ${t.input} rounded-2xl p-4 text-sm outline-none focus:border-teal-500 transition-all resize-none shadow-inner ${t.text}`}
            />
            <div className="flex items-center gap-6 px-4">
              <span className={`text-[10px] font-black ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'} uppercase tracking-tighter shrink-0`}>具体的</span>
              <input type="range" min="0" max="100" value={newNoteAbstraction} onChange={(e) => setNewNoteAbstraction(parseInt(e.target.value))} className="flex-1 accent-teal-500" />
              <span className={`text-[10px] font-black ${theme === 'dark' ? 'text-rose-400' : 'text-rose-600'} uppercase tracking-tighter shrink-0`}>抽象的</span>
            </div>
            <button onClick={addNote} className="w-full py-4 bg-teal-600 hover:bg-teal-500 active:scale-95 rounded-2xl font-black text-sm shadow-xl shadow-teal-600/20 transition-all text-white">キャンバスに追加</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderExplanation = () => (
    <div className={`space-y-12 animate-in ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} overflow-y-auto h-full pr-6 custom-scrollbar pb-20`}>
      <div className="space-y-6">
        <h2 className={`text-4xl font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'} leading-tight`}>具体⇄抽象の武器</h2>
        <div className={`${theme === 'dark' ? 'bg-indigo-600/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'} p-8 rounded-[3rem] border shadow-lg`}>
          <p className="text-lg leading-relaxed font-medium">
            思考の質を決めるのは「視点の高さ」です。
            目の前の事象（具体）に溺れず、その裏にある法則（抽象）を掴む力。
            そして、掴んだ法則を現実に落とし込む（具体化）力。
            この往復が、AI時代に求められる「本質を見抜く力」を鍛えます。
          </p>
        </div>
      </div>
      
      <div className="grid md:grid-cols-2 gap-8">
        <section className="space-y-4">
          <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'} flex items-center gap-2`}>🏃 パスとリスク</h3>
          <div className={`${t.card} p-8 rounded-[2.5rem] border space-y-4 text-sm leading-relaxed`}>
            <p><span className={`${theme === 'dark' ? 'text-white' : 'text-slate-900'} font-bold underline decoration-indigo-500 decoration-2`}>資産がある時</span>：点数が半分になります。安全策ですが、築き上げたアドバンテージを大きく失う痛みを伴います。</p>
            <p><span className="text-rose-500 font-bold underline decoration-rose-500 decoration-2">どん底の時 (0pt以下)</span>：他プレイヤーの合計得点がそのままマイナスに加算されます。逆転のチャンスを完全に奪われる致命的な一撃となり得ます。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'} flex items-center gap-2`}>🧩 難易度のグラデーション</h3>
          <div className={`${t.card} p-8 rounded-[2.5rem] border space-y-4 text-sm leading-relaxed`}>
            <p><span className="text-emerald-500 font-bold">初級</span>：専門用語を排した「日常の風景」。誰もが即座に共有できる具体的世界です。</p>
            <p><span className={`${theme === 'dark' ? 'text-white' : 'text-slate-900'} font-bold`}>普通</span>：少しだけ足が浮くような「概念」。信頼や努力など、目に見えないが手触りのある世界。</p>
            <p><span className="text-indigo-500 font-bold">上級</span>：多角的な解釈を許す「構造」。正義や自由など、文脈によって姿を変える抽象世界。</p>
            <p><span className="text-rose-500 font-bold">エキスパート</span>：答えなど存在しない「問い」。AIすら当惑する究極の思考領域。</p>
          </div>
        </section>
      </div>

      <div className={`${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-slate-100 border-slate-200'} p-8 rounded-[3rem] border text-center`}>
        <h3 className={`text-xl font-black ${theme === 'dark' ? 'text-teal-400' : 'text-teal-600'} mb-4`}>トレーニングの心得</h3>
        <p className="text-sm italic">「正解を出すこと」よりも「なぜその答えに至ったか」を言語化することを大切にしてください。他プレイヤーとの対話こそが、最高の思考訓練になります。</p>
      </div>
      
      <div className={`sticky bottom-0 ${theme === 'dark' ? 'bg-slate-950/90' : 'bg-slate-50/90'} backdrop-blur-md pt-6 pb-2 text-center border-t border-slate-200/50`}>
        <button onClick={() => setPhase('HOME')} className={`px-12 py-4 ${t.buttonMuted} rounded-full font-black text-sm border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} shadow-xl transition-all active:scale-95`}>ホームに戻る</button>
      </div>
    </div>
  );

  const renderEvaluation = () => {
    const isEasy = difficulty === '初級';
    const isPass = evaluation?.feedback.includes("パス");
    const isJudging = !isEasy && !evaluation && !isPass;

    if (isJudging) {
      return (
        <div className="text-center space-y-8 animate-in py-6">
          <h3 className={`text-2xl font-black ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>判定フェーズ</h3>
          <div className="space-y-4 max-w-sm mx-auto">
            <div className={`p-4 ${t.card} rounded-2xl border`}>
              <span className={`text-[9px] ${t.textMuted} font-black mb-1 block`}>プレイヤーの回答</span>
              <p className={`text-xl font-black ${t.text}`}>{userGuess}</p>
            </div>
            <div className="p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
              <span className="text-[9px] text-emerald-500 font-black mb-1 block">
                {difficulty === 'エキスパート' ? '中心的なテーマ' : '正解（想定）'}
              </span>
              <p className="text-xl font-black text-emerald-500">{secretWord}</p>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2 px-4">
            {[1, 2, 3, 4, 5].map(star => (
              <button key={star} onClick={() => handleManualRating(star)} className={`flex flex-col items-center gap-2 p-3 ${t.buttonMuted} border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} rounded-xl transition-all group`}>
                <span className="text-2xl group-hover:scale-125 transition-transform">★</span>
                <span className="text-[9px] font-black">{star}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    const rating = evaluation?.rating || 1;
    const evalData = EVALUATION_LEVELS.find(e => e.rating === rating) || EVALUATION_LEVELS[4];

    return (
      <div className="text-center space-y-10 animate-in py-6">
        <div className="relative">
          <div className="text-7xl mb-2">{isPass ? '🏃' : evalData.icon}</div>
          <h3 className={`text-5xl font-black mb-2 ${isPass ? 'text-rose-500' : evalData.color}`}>{isPass ? 'パス' : evalData.label}</h3>
        </div>
        <div className="space-y-2">
          <p className={`${t.textMuted} font-medium text-sm`}>正解は 「<span className={`${t.text} font-bold text-lg`}>{secretWord}</span>」 でした</p>
          <div className={`bg-slate-800/20 p-8 rounded-[2rem] border ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'} inline-block max-w-sm`}>
            <p className="text-xs italic text-slate-400 leading-relaxed">"{evaluation?.feedback}"</p>
          </div>
        </div>
        <button onClick={nextTurn} className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-xl shadow-xl shadow-indigo-600/30 transition-all text-white">次へ進む</button>
      </div>
    );
  };

  const renderGameConfig = () => (
    <div className="space-y-8 animate-in max-w-sm mx-auto">
      <div>
        <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} mb-4`}>難易度設定</h2>
        <div className="grid grid-cols-2 gap-2">
          {(['初級', '普通', '上級', 'エキスパート'] as Difficulty[]).map(d => (
            <button key={d} onClick={() => setDifficulty(d)} className={`py-3 rounded-xl font-bold border transition-all ${difficulty === d ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : `${t.buttonMuted} ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}`}>{d}</button>
          ))}
        </div>
      </div>
      <div>
        <h2 className={`text-lg font-bold ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} mb-4`}>ラウンド数</h2>
        <div className="flex items-center gap-4">
           {[1, 3, 5, 10].map(r => (
             <button key={r} onClick={() => setTotalRounds(r)} className={`flex-1 py-3 rounded-xl font-bold border transition-all ${totalRounds === r ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : `${t.buttonMuted} ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}`}>{r}</button>
           ))}
        </div>
      </div>
      <button onClick={() => setPhase('PLAYER_INPUT')} className="w-full py-4 bg-indigo-600 rounded-2xl font-black text-xl shadow-xl shadow-indigo-600/20 text-white">プレイヤー設定へ</button>
    </div>
  );

  const renderPlayerInput = () => (
    <div className="space-y-6 animate-in max-w-sm mx-auto">
      <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} text-center`}>プレイヤー登録</h2>
      {players.map((p, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input type="text" value={p.name} placeholder={`プレイヤー ${i + 1}`} onChange={(e) => { const n = [...players]; n[i].name = e.target.value; setPlayers(n); }} className={`flex-1 ${t.input} rounded-xl px-4 py-3 focus:border-indigo-500 outline-none ${t.text}`} />
          {players.length > 1 && <button onClick={() => setPlayers(players.filter((_, idx) => idx !== i))} className="p-3 text-slate-400 hover:text-rose-500 transition-colors">✕</button>}
        </div>
      ))}
      <button onClick={() => setPlayers([...players, { name: '', score: 0 }])} className={`w-full py-2 ${t.buttonMuted} rounded-xl text-xs font-bold border border-dashed ${theme === 'dark' ? 'border-slate-700' : 'border-slate-300'}`}>＋ プレイヤーを追加</button>
      <button onClick={startOrderSelection} className="w-full py-4 bg-indigo-600 rounded-2xl font-black text-xl shadow-xl shadow-indigo-600/20 text-white">順番を決める</button>
    </div>
  );

  const renderOrderSelect = () => (
    <div className="space-y-8 animate-in text-center max-w-sm mx-auto">
      <h2 className={`text-2xl font-black ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>対戦順の確認</h2>
      <div className="space-y-3">
        {players.map((p, i) => (
          <div key={i} className={`${t.card} p-4 rounded-2xl border flex items-center justify-between`}>
            <span className={`${t.textMuted} font-black text-[9px] uppercase tracking-widest`}>Player {i + 1}</span>
            <span className={`text-xl font-bold ${t.text}`}>{p.name}</span>
          </div>
        ))}
      </div>
      <button onClick={startPlaying} className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 rounded-3xl font-black text-xl shadow-xl shadow-indigo-600/30 transition-all text-white">ゲーム開始</button>
    </div>
  );

  const renderFinalResult = () => {
    const winners = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="space-y-8 animate-in text-center max-md mx-auto">
        <div className="py-6">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="text-4xl font-black bg-gradient-to-r from-yellow-400 to-amber-600 bg-clip-text text-transparent italic">FINAL RESULT</h2>
        </div>
        <div className="space-y-4">
          {winners.map((p, i) => (
            <div key={p.name} className={`p-6 rounded-[2rem] border flex items-center justify-between transition-all ${i === 0 ? 'bg-indigo-600/20 border-indigo-400 shadow-lg' : t.card}`}>
              <div className="flex items-center gap-4">
                <span className={`text-2xl font-black ${i === 0 ? 'text-yellow-500' : t.textMuted}`}>{i + 1}</span>
                <span className={`text-xl font-bold ${i === 0 ? t.text : t.textMuted}`}>{p.name}</span>
              </div>
              <span className={`text-2xl font-mono font-black ${p.score >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{p.score} <span className="text-xs">PTS</span></span>
            </div>
          ))}
        </div>
        <button onClick={resetGame} className={`w-full py-5 ${t.buttonMuted} rounded-2xl font-black text-xl border transition-all mt-4`}>タイトルに戻る</button>
      </div>
    );
  };

  const isWidePhase = phase === 'EXPLANATION' || phase === 'BRAINSTORM';

  return (
    <div className={`min-h-screen ${t.bg} ${t.text} flex flex-col items-center justify-center p-4 font-sans transition-colors duration-500 overflow-x-hidden`}>
      <div className={`${isWidePhase ? 'max-w-full w-full h-full border-none rounded-none bg-transparent p-0' : `max-w-xl w-full ${t.container} rounded-[3rem] p-8 md:p-12 shadow-2xl overflow-hidden min-h-[500px] flex flex-col transition-all duration-500`}`}>
        {!isWidePhase && (
          <>
            <div className={`absolute -top-40 -left-40 w-96 h-96 ${theme === 'dark' ? 'bg-indigo-600/10' : 'bg-indigo-200/20'} rounded-full blur-[100px] pointer-events-none`}></div>
            <div className={`absolute -bottom-40 -right-40 w-96 h-96 ${theme === 'dark' ? 'bg-teal-600/10' : 'bg-teal-200/20'} rounded-full blur-[100px] pointer-events-none`}></div>
            
            <header className="flex justify-between items-start mb-10 relative z-10 shrink-0">
              <div>
                <h1 className={`text-4xl md:text-5xl font-black tracking-tighter ${theme === 'dark' ? 'bg-gradient-to-r from-indigo-400 via-teal-400 to-emerald-400' : 'bg-gradient-to-r from-indigo-600 via-teal-600 to-emerald-600'} bg-clip-text text-transparent`}>具体⇄抽象トレーニング</h1>
                <p className={`${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'} font-black tracking-[0.2em] text-[10px] uppercase mt-1`}>AI Logic & Vocabulary</p>
              </div>
              <div className="flex gap-2">
                <button onClick={toggleTheme} className={`p-3 ${t.buttonMuted} rounded-2xl transition-all border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200 shadow-sm'}`}>
                  {theme === 'dark' ? '🌞' : '🌙'}
                </button>
                {phase !== 'HOME' && (
                  <button onClick={resetGame} className={`p-3 ${t.buttonMuted} rounded-2xl transition-all border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200 shadow-sm'}`}>🏠</button>
                )}
              </div>
            </header>
          </>
        )}

        <main className={`relative z-10 flex-1 ${isWidePhase ? 'w-full h-screen' : 'min-h-[400px]'}`}>
          {phase === 'HOME' && renderHome()}
          {phase === 'GAME_CONFIG' && renderGameConfig()}
          {phase === 'PLAYER_INPUT' && renderPlayerInput()}
          {phase === 'ORDER_SELECT' && renderOrderSelect()}
          {phase === 'PLAYING' && renderPlaying()}
          {phase === 'EVALUATION' && renderEvaluation()}
          {phase === 'FINAL_RESULT' && renderFinalResult()}
          {phase === 'BRAINSTORM' && renderBrainstorm()}
          {phase === 'EXPLANATION' && (
            <div className={`flex justify-center h-screen ${t.bg} p-8 md:p-16 transition-colors duration-500`}>
               <div className="max-w-5xl w-full relative">
                 <button onClick={toggleTheme} className={`absolute top-0 right-0 p-3 ${t.buttonMuted} rounded-2xl transition-all border ${theme === 'dark' ? 'border-slate-700' : 'border-slate-200 shadow-sm'} z-50`}>
                  {theme === 'dark' ? '🌞' : '🌙'}
                 </button>
                 {renderExplanation()}
               </div>
            </div>
          )}
        </main>

        {!isWidePhase && (
          <footer className="mt-8 pt-6 border-t border-slate-800/10 text-center relative z-10 opacity-40 shrink-0">
            <p className="text-[10px] font-black tracking-[0.5em] text-slate-500 uppercase">Powered by Gemini 3 Flash v6.2</p>
          </footer>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        
        .custom-scrollbar-wide::-webkit-scrollbar { width: 10px; height: 10px; }
        .custom-scrollbar-wide::-webkit-scrollbar-track { background: ${theme === 'dark' ? '#020617' : '#f8fafc'}; }
        .custom-scrollbar-wide::-webkit-scrollbar-thumb { background: ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}; border-radius: 10px; border: 2px solid ${theme === 'dark' ? '#020617' : '#f8fafc'}; }

        input[type="range"] { -webkit-appearance: none; background: ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}; border-radius: 10px; height: 6px; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; height: 18px; width: 18px; border-radius: 50%; background: #2dd4bf; cursor: pointer; border: 2px solid white; box-shadow: 0 0 10px rgba(45, 212, 191, 0.4); }
      `}</style>
    </div>
  );

  function renderPlaying() {
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="space-y-6 animate-in">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {sortedPlayers.map((p, i) => (
            <div key={p.name} className={`px-2 py-2 rounded-xl border text-[8px] flex flex-col items-center justify-center transition-all ${players[currentPlayerIdx].name === p.name ? 'bg-indigo-600/20 border-indigo-400 scale-105 z-10' : `${t.card} opacity-60`}`}>
              <span className={`font-black ${t.text} truncate w-full text-center`}>#{i+1} {p.name}</span>
              <span className={`font-mono font-black ${p.score >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{p.score} pt</span>
            </div>
          ))}
        </div>
        <div className={`flex justify-between items-center text-[10px] font-black tracking-widest ${t.textMuted} border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'} pt-4`}>
          <span>ROUND {currentRound} / {totalRounds}</span>
          <span className={`px-3 py-1 rounded-full border ${theme === 'dark' ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/20' : 'text-emerald-600 bg-emerald-50 border-emerald-200'}`}>{players[currentPlayerIdx].name} さんの番</span>
        </div>
        {loading ? (
          <div className="py-20 flex flex-col items-center"><div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4"></div><p className={`text-xs ${t.textMuted} animate-pulse font-bold tracking-widest uppercase`}>Weaving Words...</p></div>
        ) : (
          <>
            <div className="grid gap-3">
              {clues.map((clue, i) => (
                <div key={i} className={`${t.card} p-6 rounded-3xl group hover:border-indigo-500/30 transition-all`}>
                  <span className={`block text-[9px] ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'} font-black mb-2 opacity-50 uppercase`}>HINT {i + 1}</span>
                  <p className={`${difficulty === 'エキスパート' ? 'text-[11px]' : 'text-xl'} font-bold leading-relaxed ${t.text}`}>{clue}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleGuess} className="space-y-4">
              <div className="relative">
                <input ref={inputRef} type="text" value={userGuess} onChange={(e) => setUserGuess(e.target.value)} placeholder="回答を入力..." className={`w-full ${t.input} rounded-2xl px-6 py-5 text-xl font-bold focus:border-indigo-500 outline-none ${t.text} ${theme === 'light' ? 'shadow-lg' : ''}`} />
                <button className="absolute right-3 top-3 bottom-3 px-6 bg-indigo-600 rounded-xl font-black text-sm transition-all hover:bg-indigo-500 active:scale-95 text-white">回答</button>
              </div>
              <button type="button" onClick={handlePass} className={`w-full py-3 ${t.buttonMuted} rounded-xl font-bold hover:text-rose-500 transition-colors`}>パスする</button>
            </form>
          </>
        )}
      </div>
    );
  }
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<WordWeaver />);
}
