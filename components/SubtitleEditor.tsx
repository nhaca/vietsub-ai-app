
import React from 'react';
import { SubtitleEntry, TranslationDirection } from '../types';

interface SubtitleEditorProps {
  subtitles: SubtitleEntry[];
  setSubtitles: React.Dispatch<React.SetStateAction<SubtitleEntry[]>>;
  currentTime: number;
  direction: TranslationDirection;
}

const SubtitleEditor: React.FC<SubtitleEditorProps> = ({ subtitles, setSubtitles, currentTime, direction }) => {
  const updateSub = (id: string, field: keyof SubtitleEntry, value: any) => {
    setSubtitles(prev => prev.map(sub => sub.id === id ? { ...sub, [field]: value } : sub));
  };

  const removeSub = (id: string) => {
    setSubtitles(prev => prev.filter(sub => sub.id !== id));
  };

  const addSub = () => {
    const newSub: SubtitleEntry = {
      id: Date.now().toString(),
      startTime: currentTime,
      endTime: currentTime + 2,
      originalText: "Văn bản gốc mới",
      translatedText: "Bản dịch mới"
    };
    setSubtitles(prev => [...prev, newSub].sort((a, b) => a.startTime - b.startTime));
  };

  const labels = {
    original: direction === 'zh-vi' ? 'Gốc (Trung)' : 'Gốc (Việt)',
    translated: direction === 'zh-vi' ? 'Dịch (Việt)' : 'Dịch (Trung)',
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-full min-h-0 overflow-hidden">
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
        <h3 className="font-bold text-slate-200">Danh sách phụ đề</h3>
        <button onClick={addSub} className="p-1 px-3 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-bold transition-colors">
          + THÊM
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {subtitles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 italic space-y-2 py-10">
            <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <p>Chưa có phụ đề</p>
          </div>
        ) : (
          subtitles.map(sub => {
            const isActive = currentTime >= sub.startTime && currentTime <= sub.endTime;
            return (
              <div key={sub.id} className={`p-3 rounded-lg border transition-all ${isActive ? 'bg-slate-700 border-emerald-500 shadow-lg scale-[1.02]' : 'bg-slate-900 border-slate-700 opacity-80'}`}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex gap-2 items-center">
                     <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase font-black">Bắt đầu</span>
                        <input type="number" step="0.1" value={sub.startTime} onChange={(e) => updateSub(sub.id, 'startTime', Number(e.target.value))}
                          className="w-14 bg-slate-800 border border-slate-700 rounded px-1 text-[10px] font-mono text-emerald-400 focus:outline-none" />
                     </div>
                     <span className="text-slate-600 text-[10px] mt-2">→</span>
                     <div className="flex flex-col">
                        <span className="text-[8px] text-slate-500 uppercase font-black">Kết thúc</span>
                        <input type="number" step="0.1" value={sub.endTime} onChange={(e) => updateSub(sub.id, 'endTime', Number(e.target.value))}
                          className="w-14 bg-slate-800 border border-slate-700 rounded px-1 text-[10px] font-mono text-emerald-400 focus:outline-none" />
                     </div>
                  </div>
                  <button onClick={() => removeSub(sub.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
                <div className="space-y-2">
                  <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                    value={sub.originalText} onChange={(e) => updateSub(sub.id, 'originalText', e.target.value)} placeholder={labels.original} />
                  <textarea className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-emerald-400 font-medium focus:outline-none focus:border-emerald-500 resize-none"
                    rows={2} value={sub.translatedText} onChange={(e) => updateSub(sub.id, 'translatedText', e.target.value)} placeholder={labels.translated} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SubtitleEditor;
