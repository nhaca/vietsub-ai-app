
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SubtitleEntry, BlurRegion, ProcessStatus, TranslationStyle, TranslationDirection, VideoQueueItem, HistoryState } from './types';
import VideoWorkspace, { VideoWorkspaceHandle } from './components/VideoWorkspace';
import SubtitleEditor from './components/SubtitleEditor';
import { extractSubtitlesFromVideo, translateSubtitles, generateVoiceover } from './services/geminiService';
import { parseSRT } from './utils/srt';

const STYLES: TranslationStyle[] = [
  'Hiện đại', 'Tu tiên', 'Kinh dị', 'Cổ đại', 
  'Chuyên nghiệp', 'Học đường', 'Tình yêu', 'Tự nhiên'
];

const FONTS = ['Inter', 'Roboto', 'Open Sans'];

const App: React.FC = () => {
  const [style, setStyle] = useState<TranslationStyle>(() => (localStorage.getItem('translator_style') as TranslationStyle) || 'Tự nhiên');
  const [direction, setDirection] = useState<TranslationDirection>(() => (localStorage.getItem('translator_direction') as TranslationDirection) || 'zh-vi');
  const [globalFontFamily, setGlobalFontFamily] = useState<string>(() => localStorage.getItem('translator_fontFamily') || 'Inter');
  const [globalFontSize, setGlobalFontSize] = useState<number>(() => Number(localStorage.getItem('translator_fontSize')) || 18);

  const [queue, setQueue] = useState<VideoQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  const workspaceRef = useRef<VideoWorkspaceHandle>(null);
  const timerRef = useRef<number | null>(null);

  const activeVideo = currentIndex >= 0 ? queue[currentIndex] : null;

  useEffect(() => {
    localStorage.setItem('translator_style', style);
    localStorage.setItem('translator_direction', direction);
    localStorage.setItem('translator_fontFamily', globalFontFamily);
    localStorage.setItem('translator_fontSize', globalFontSize.toString());
  }, [style, direction, globalFontFamily, globalFontSize]);

  useEffect(() => {
    const isProcessing = queue.some(item => 
      [ProcessStatus.EXTRACTING, ProcessStatus.TRANSLATING, ProcessStatus.GENERATING_VOICE, ProcessStatus.EXPORTING].includes(item.status)
    );

    if (isProcessing) {
      if (!timerRef.current) {
        const start = Date.now();
        timerRef.current = window.setInterval(() => {
          setElapsedTime(Math.floor((Date.now() - start) / 1000));
        }, 1000);
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setElapsedTime(0);
      }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [queue]);

  const pushToHistory = useCallback((index: number, subtitles: SubtitleEntry[], blurRegions: BlurRegion[]) => {
    setQueue(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      const newState: HistoryState = { subtitles: [...subtitles], blurRegions: [...blurRegions] };
      const newHistory = item.history.slice(0, item.historyIndex + 1);
      // Giới hạn lịch sử 50 bước
      if (newHistory.length >= 50) newHistory.shift();
      return {
        ...item,
        history: [...newHistory, newState],
        historyIndex: newHistory.length
      };
    }));
  }, []);

  const undo = () => {
    if (!activeVideo || activeVideo.historyIndex <= 0) return;
    setQueue(prev => prev.map((item, idx) => {
      if (idx !== currentIndex) return item;
      const newIdx = item.historyIndex - 1;
      const state = item.history[newIdx];
      return { ...item, historyIndex: newIdx, subtitles: state.subtitles, blurRegions: state.blurRegions };
    }));
  };

  const redo = () => {
    if (!activeVideo || activeVideo.historyIndex >= activeVideo.history.length - 1) return;
    setQueue(prev => prev.map((item, idx) => {
      if (idx !== currentIndex) return item;
      const newIdx = item.historyIndex + 1;
      const state = item.history[newIdx];
      return { ...item, historyIndex: newIdx, subtitles: state.subtitles, blurRegions: state.blurRegions };
    }));
  };

  const handleFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      const newItems: VideoQueueItem[] = files.map(file => {
        const url = URL.createObjectURL(file);
        return {
          file, url, status: ProcessStatus.IDLE, subtitles: [], blurRegions: [], progress: 0,
          fontFamily: globalFontFamily, fontSize: globalFontSize,
          history: [{ subtitles: [], blurRegions: [] }], historyIndex: 0
        };
      });
      setQueue(prev => [...prev, ...newItems]);
      if (currentIndex === -1) setCurrentIndex(0);
    }
  };

  const updateActiveVideo = (updates: Partial<VideoQueueItem>) => {
    setQueue(prev => prev.map((item, idx) => {
      if (idx !== currentIndex) return item;
      const newItem = { ...item, ...updates };
      // Nếu có sự thay đổi về nội dung dữ liệu (subs hoặc regions), đẩy vào lịch sử
      if (updates.subtitles || updates.blurRegions) {
        const subtitles = updates.subtitles || item.subtitles;
        const blurRegions = updates.blurRegions || item.blurRegions;
        // Tránh push lặp nếu dữ liệu không đổi
        if (JSON.stringify(subtitles) !== JSON.stringify(item.subtitles) || JSON.stringify(blurRegions) !== JSON.stringify(item.blurRegions)) {
          // Logic pushToHistory tích hợp trực tiếp để đảm bảo nguyên tử
          const newState: HistoryState = { subtitles: [...subtitles], blurRegions: [...blurRegions] };
          const newHistory = item.history.slice(0, item.historyIndex + 1);
          if (newHistory.length >= 50) newHistory.shift();
          newItem.history = [...newHistory, newState];
          newItem.historyIndex = newHistory.length;
        }
      }
      return newItem;
    }));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result?.toString().split(',')[1] || "");
      reader.onerror = reject;
    });
  };

  const handleSrtImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeVideo) return;
    const text = await file.text();
    const subs = parseSRT(text);
    updateActiveVideo({ subtitles: subs });
  };

  const processVideo = async (index: number) => {
    const item = queue[index];
    if (!item) return;

    if (item.blurRegions.length === 0) {
      setErrorMsg(`Video "${item.file.name}" chưa có vùng che! Hãy vẽ ít nhất 1 vùng.`);
      setCurrentIndex(index);
      setIsDrawing(true);
      return;
    }

    try {
      const updateStatus = (status: ProcessStatus, extra?: Partial<VideoQueueItem>) => {
        setQueue(q => q.map((v, i) => i === index ? { ...v, status, ...extra } : v));
      };

      updateStatus(ProcessStatus.EXTRACTING, { processingStartTime: Date.now() });
      const base64 = await fileToBase64(item.file);
      
      // Nếu đã có phụ đề (từ import SRT), bỏ qua bước trích xuất
      let subs = item.subtitles.length > 0 ? item.subtitles : await extractSubtitlesFromVideo(base64, direction);
      
      updateStatus(ProcessStatus.TRANSLATING, { subtitles: subs, totalSubtitles: subs.length });
      const translated = await translateSubtitles(subs, style, direction);
      
      updateStatus(ProcessStatus.GENERATING_VOICE, { subtitles: translated, totalSubtitles: translated.length, currentSubtitleIndex: 0 });
      const finalizedSubs: SubtitleEntry[] = [];
      for (let i = 0; i < translated.length; i++) {
        setQueue(q => q.map((v, i_q) => i_q === index ? { ...v, currentSubtitleIndex: i + 1 } : v));
        if (i > 0) await new Promise(r => setTimeout(r, 600)); 
        const audio = await generateVoiceover(translated[i].translatedText, direction);
        finalizedSubs.push({ ...translated[i], audioUrl: audio });
      }

      setQueue(q => q.map((v, i) => i === index ? { 
        ...v, status: ProcessStatus.COMPLETED, subtitles: finalizedSubs, currentSubtitleIndex: finalizedSubs.length
      } : v));

    } catch (err: any) {
      setQueue(q => q.map((v, i) => i === index ? { ...v, status: ProcessStatus.ERROR } : v));
      const errMsg = err.message?.includes('429') 
        ? "Lỗi: Đã hết hạn mức sử dụng (Quota Exceeded). Vui lòng đợi vài phút và thử lại." 
        : err.message;
      setErrorMsg(errMsg);
    }
  };

  const runAll = async () => {
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status === ProcessStatus.IDLE || queue[i].status === ProcessStatus.ERROR) {
        await processVideo(i);
      }
    }
  };

  const handleExport = async () => {
    if (!workspaceRef.current || !activeVideo) return;
    updateActiveVideo({ status: ProcessStatus.EXPORTING });
    const blob = await workspaceRef.current.exportVideo((p) => setGlobalProgress(p));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_${activeVideo.file.name.split('.')[0]}.webm`;
    a.click();
    updateActiveVideo({ status: ProcessStatus.COMPLETED });
  };

  const formatElapsedTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="p-6 bg-slate-900/50 border-b border-white/5 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-blue-500 bg-clip-text text-transparent">
            MULTI-VIDEO TRANSLATOR PRO
          </h1>
          <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">AI Subtitle & Voiceover Studio</p>
        </div>
        <div className="flex gap-4 items-center">
           <div className="flex flex-col gap-1">
             <span className="text-[10px] text-slate-500 font-bold uppercase">Hướng dịch</span>
             <select value={direction} onChange={(e) => setDirection(e.target.value as TranslationDirection)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none font-bold text-emerald-400">
              <option value="zh-vi">Trung ➔ Việt (Giọng Nữ Ngọt)</option>
              <option value="vi-zh">Việt ➔ Trung (Giọng Nam Trầm)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[10px] text-slate-500 font-bold uppercase">Phong cách</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as TranslationStyle)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none">
              {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <label className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl text-white font-black cursor-pointer transition-all shadow-xl shadow-blue-900/20 text-sm mt-4">
            + THÊM VIDEO
            <input type="file" multiple accept="video/*" className="hidden" onChange={handleFilesUpload} />
          </label>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-white/5 bg-slate-900/30 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Hàng đợi ({queue.length})</h2>
            <button onClick={() => setQueue([])} className="text-[10px] text-red-500 hover:underline">Xóa hết</button>
          </div>
          <div className="space-y-2">
            {queue.map((item, idx) => (
              <div key={idx} onClick={() => setCurrentIndex(idx)}
                className={`p-3 rounded-xl border cursor-pointer transition-all relative overflow-hidden group ${currentIndex === idx ? 'bg-blue-600/20 border-blue-500 shadow-xl' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}`}>
                <div className="flex justify-between items-start mb-1 relative z-10">
                  <span className="text-xs font-bold truncate w-40">{item.file.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                    item.status === ProcessStatus.COMPLETED ? 'bg-emerald-500 text-black' :
                    item.status === ProcessStatus.ERROR ? 'bg-red-500 text-white' :
                    item.status === ProcessStatus.IDLE ? 'bg-slate-700 text-slate-400' : 'bg-blue-500 text-white'
                  }`}>{item.status}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                   <span>{item.blurRegions.length} vùng • {item.subtitles.length} phụ đề</span>
                   {item.status !== ProcessStatus.IDLE && item.status !== ProcessStatus.COMPLETED && item.status !== ProcessStatus.ERROR && (
                      <span className="text-emerald-400 font-mono">{formatElapsedTime(elapsedTime)}</span>
                   )}
                </div>
                {item.status !== ProcessStatus.IDLE && (
                  <div className="w-full bg-slate-700 h-1 rounded-full mt-2 overflow-hidden">
                     <div className={`h-full transition-all duration-500 ${item.status === ProcessStatus.COMPLETED ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`} 
                          style={{ width: item.status === ProcessStatus.COMPLETED ? '100%' : '50%' }}></div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {queue.length > 0 && (
            <button onClick={runAll} className="mt-auto bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-black text-xs uppercase shadow-2xl transition-transform active:scale-95">
              CHẠY TẤT CẢ ({queue.filter(i => i.status === ProcessStatus.IDLE).length})
            </button>
          )}
        </aside>

        <main className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
          <div className="col-span-8 flex flex-col gap-6 overflow-hidden">
            {activeVideo ? (
              <>
                <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-2xl border border-white/5">
                   <div className="flex gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Phông chữ</span>
                        <select value={activeVideo.fontFamily} onChange={(e) => { updateActiveVideo({ fontFamily: e.target.value }); setGlobalFontFamily(e.target.value); }}
                            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-sm outline-none font-bold text-blue-400">
                          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Cỡ chữ</span>
                        <div className="flex items-center gap-3">
                          <input type="range" min="12" max="36" step="1" value={activeVideo.fontSize} onChange={(e) => { const val = Number(e.target.value); updateActiveVideo({ fontSize: val }); setGlobalFontSize(val); }}
                             className="w-32 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                          <span className="text-xs font-black text-blue-400">{activeVideo.fontSize}px</span>
                        </div>
                      </div>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={undo} disabled={activeVideo.historyIndex <= 0} className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-30">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                      </button>
                      <button onClick={redo} disabled={activeVideo.historyIndex >= activeVideo.history.length - 1} className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-30">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" /></svg>
                      </button>
                   </div>
                </div>
                <VideoWorkspace ref={workspaceRef} videoUrl={activeVideo.url} subtitles={activeVideo.subtitles} currentTime={currentTime} onTimeUpdate={setCurrentTime} blurRegions={activeVideo.blurRegions}
                  setBlurRegions={(val) => {
                    const regions = typeof val === 'function' ? val(activeVideo.blurRegions) : val;
                    updateActiveVideo({ blurRegions: regions });
                  }}
                  isDrawing={isDrawing} setIsDrawing={setIsDrawing} fontFamily={activeVideo.fontFamily} fontSize={activeVideo.fontSize} />
                <div className="flex gap-4">
                  <button disabled={activeVideo.status !== ProcessStatus.IDLE && activeVideo.status !== ProcessStatus.ERROR && activeVideo.status !== ProcessStatus.COMPLETED}
                    onClick={() => processVideo(currentIndex)} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 py-4 rounded-2xl font-black text-sm uppercase shadow-2xl transition-all active:scale-[0.98]">
                    BẮT ĐẦU DỊCH VIDEO NÀY
                  </button>
                  {activeVideo.status === ProcessStatus.COMPLETED && (
                    <button onClick={handleExport} className="px-10 bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-black text-sm uppercase shadow-2xl animate-bounce">
                      XUẤT VIDEO
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 border-2 border-dashed border-slate-800 rounded-[32px] flex flex-col items-center justify-center text-slate-600 bg-slate-900/10">
                 <div className="w-24 h-24 mb-6 bg-slate-900 rounded-full flex items-center justify-center border border-slate-800 shadow-inner">
                    <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                 </div>
                 <p className="text-xl font-bold text-slate-400">Tải video lên để bắt đầu quy trình</p>
                 <p className="text-slate-600 text-sm mt-2">Dịch thuật • Lồng tiếng • Che phụ đề cũ</p>
              </div>
            )}
          </div>

          <div className="col-span-4 h-full overflow-hidden flex flex-col gap-4">
             {activeVideo && (
               <>
                 <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Nhập tệp SRT (Tùy chọn)</label>
                    <input type="file" accept=".srt" onChange={handleSrtImport} className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-black file:bg-blue-600 file:text-white hover:file:bg-blue-500" />
                 </div>
                 <SubtitleEditor subtitles={activeVideo.subtitles}
                   setSubtitles={(val) => {
                      const subs = typeof val === 'function' ? val(activeVideo.subtitles) : val;
                      updateActiveVideo({ subtitles: subs });
                   }}
                   currentTime={currentTime} direction={direction} />
               </>
             )}
          </div>
        </main>
      </div>

      {currentIndex >= 0 && [ProcessStatus.EXTRACTING, ProcessStatus.TRANSLATING, ProcessStatus.GENERATING_VOICE, ProcessStatus.EXPORTING].includes(queue[currentIndex].status) && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[100] flex items-center justify-center">
          <div className="text-center space-y-8 max-w-md p-8 bg-slate-900 border border-white/10 rounded-[40px] shadow-2xl">
            <div className="relative w-48 h-48 mx-auto">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-800" strokeWidth="1.5" />
                <circle cx="18" cy="18" r="16" fill="none" className="stroke-emerald-500" strokeWidth="2" 
                  strokeDasharray={`${activeVideo?.status === ProcessStatus.EXPORTING ? globalProgress : ((activeVideo?.currentSubtitleIndex || 0) / (activeVideo?.totalSubtitles || 1) * 100)} 100`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-4xl font-black text-emerald-400">{activeVideo?.status === ProcessStatus.EXPORTING ? Math.floor(globalProgress) : Math.floor(((activeVideo?.currentSubtitleIndex || 0) / (activeVideo?.totalSubtitles || 1) * 100))}%</span>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{activeVideo?.status}</span>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">
                {activeVideo?.status === ProcessStatus.EXTRACTING && "Đang trích xuất toàn bộ thoại..."}
                {activeVideo?.status === ProcessStatus.TRANSLATING && "Đang dịch thuật..."}
                {activeVideo?.status === ProcessStatus.GENERATING_VOICE && `Đang lồng tiếng AI... (${activeVideo.currentSubtitleIndex}/${activeVideo.totalSubtitles})`}
                {activeVideo?.status === ProcessStatus.EXPORTING && "Đang Render Video..."}
              </h3>
              <div className="flex justify-center items-center gap-4 text-slate-400 text-sm">
                 <span className="flex items-center gap-1">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                   {formatElapsedTime(elapsedTime)}
                 </span>
                 <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                 <span>Vui lòng không đóng trình duyệt</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-600 text-white px-8 py-4 rounded-2xl shadow-[0_20px_50px_rgba(220,38,38,0.3)] flex items-center gap-4 z-[200] animate-in fade-in slide-in-from-bottom-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span className="font-bold">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="ml-4 bg-white/20 hover:bg-white/30 w-8 h-8 rounded-full flex items-center justify-center">✕</button>
        </div>
      )}
    </div>
  );
};

export default App;
