
import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { BlurRegion, SubtitleEntry } from '../types';

interface VideoWorkspaceProps {
  videoUrl: string;
  subtitles: SubtitleEntry[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  blurRegions: BlurRegion[];
  setBlurRegions: (val: BlurRegion[] | ((prev: BlurRegion[]) => BlurRegion[])) => void;
  isDrawing: boolean;
  setIsDrawing: (val: boolean) => void;
  fontFamily?: string;
  fontSize?: number;
}

export interface VideoWorkspaceHandle {
  exportVideo: (onProgress: (p: number) => void) => Promise<Blob>;
}

const VideoWorkspace = forwardRef<VideoWorkspaceHandle, VideoWorkspaceProps>(({
  videoUrl,
  subtitles,
  currentTime,
  onTimeUpdate,
  blurRegions,
  setBlurRegions,
  isDrawing,
  setIsDrawing,
  fontFamily = 'Inter',
  fontSize = 18
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  
  const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
  const [currentDrag, setCurrentDrag] = useState<BlurRegion | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<'move' | 'resize' | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number, y: number } | null>(null);
  const [blurOpacity, setBlurOpacity] = useState(90);

  const activeSub = subtitles.find(s => currentTime >= s.startTime && currentTime <= s.endTime);
  
  const mainBlur = blurRegions.length > 0 
    ? blurRegions.reduce((prev, current) => (prev.y > current.y ? prev : current))
    : null;

  useEffect(() => {
    if (!activeSub || !activeSub.audioUrl) {
      if (activeAudio.current) {
        activeAudio.current.pause();
        activeAudio.current = null;
      }
      return;
    }

    if (activeAudio.current?.src === activeSub.audioUrl) return;

    if (activeAudio.current) {
      activeAudio.current.pause();
    }

    let audio = audioCache.current.get(activeSub.audioUrl);
    if (!audio) {
      audio = new Audio(activeSub.audioUrl);
      audioCache.current.set(activeSub.audioUrl, audio);
    }
    
    audio.currentTime = 0;
    audio.play().catch(() => {});
    activeAudio.current = audio;

  }, [activeSub, currentTime]);

  useImperativeHandle(ref, () => ({
    exportVideo: async (onProgress) => {
      if (!videoRef.current) throw new Error("Video không sẵn sàng");
      
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Không thể tạo context 2D");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const stream = canvas.captureStream(30);
      const audioCtx = new AudioContext();
      const destination = audioCtx.createMediaStreamDestination();
      
      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);

      return new Promise(async (resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        
        const originalTime = video.currentTime;
        const duration = video.duration;
        video.pause();
        video.currentTime = 0;
        
        recorder.start();
        
        const renderFrame = async () => {
          if (video.currentTime >= duration) {
            recorder.stop();
            video.currentTime = originalTime;
            return;
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          blurRegions.forEach(region => {
            const rx = (region.x / 100) * canvas.width;
            const ry = (region.y / 100) * canvas.height;
            const rw = (region.width / 100) * canvas.width;
            const rh = (region.height / 100) * canvas.height;

            ctx.save();
            ctx.filter = 'blur(30px)';
            ctx.drawImage(canvas, rx, ry, rw, rh, rx, ry, rw, rh);
            ctx.restore();
            
            ctx.fillStyle = `rgba(0,0,0,${blurOpacity / 100})`;
            ctx.fillRect(rx, ry, rw, rh);

            const currentSub = subtitles.find(s => video.currentTime >= s.startTime && video.currentTime <= s.endTime);
            if (currentSub && region === mainBlur) {
              const text = currentSub.translatedText || currentSub.originalText;
              // Tính toán font size tương đối cho export (dựa trên tỷ lệ canvas)
              const scaledFontSize = (fontSize / 1080) * canvas.height * 2; 
              ctx.font = `bold ${scaledFontSize}px ${fontFamily}, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              ctx.strokeStyle = 'rgba(0,0,0,0.8)';
              ctx.lineWidth = Math.max(2, scaledFontSize / 8);
              ctx.strokeText(text, rx + rw/2, ry + rh/2);
              
              ctx.fillStyle = '#fde047';
              ctx.fillText(text, rx + rw/2, ry + rh/2);
            }
          });

          onProgress((video.currentTime / duration) * 100);
          video.currentTime += 1/30;
          await new Promise(r => setTimeout(r, 10));
          requestAnimationFrame(renderFrame);
        };

        renderFrame();
      });
    }
  }));

  const getRelativeCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editingIdx !== null && !isDrawing) {
      const target = e.target as HTMLElement;
      if (!target.closest('.blur-region-item')) {
        setEditingIdx(null);
      }
    }
    if (!isDrawing || !containerRef.current) return;
    const coords = getRelativeCoords(e);
    setStartPos(coords);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getRelativeCoords(e);
    if (isDrawing && startPos) {
      setCurrentDrag({
        x: Math.min(startPos.x, coords.x),
        y: Math.min(startPos.y, coords.y),
        width: Math.abs(coords.x - startPos.x),
        height: Math.abs(coords.y - startPos.y)
      });
      return;
    }

    if (editingIdx !== null && editAction && containerRef.current) {
      const regionIdx = editingIdx;
      const moveAction = editAction;
      const offset = dragOffset;

      setBlurRegions(prev => {
        const next = [...prev];
        const region = { ...next[regionIdx] };

        if (moveAction === 'move' && offset) {
          region.x = Math.max(0, Math.min(100 - region.width, coords.x - offset.x));
          region.y = Math.max(0, Math.min(100 - region.height, coords.y - offset.y));
        } else if (moveAction === 'resize') {
          region.width = Math.max(1, coords.x - region.x);
          region.height = Math.max(1, coords.y - region.y);
        }
        next[regionIdx] = region;
        return next;
      });
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentDrag) {
      if (currentDrag.width > 0.5 && currentDrag.height > 0.5) {
        setBlurRegions(prev => [...prev, currentDrag]);
      }
      setCurrentDrag(null);
      setStartPos(null);
      setIsDrawing(false);
    }
    setEditAction(null);
    setDragOffset(null);
  };

  const handleRegionMouseDown = (idx: number, e: React.MouseEvent) => {
    if (isDrawing) return;
    e.stopPropagation();
    setEditingIdx(idx);
    const coords = getRelativeCoords(e);
    const region = blurRegions[idx];
    setEditAction('move');
    setDragOffset({ x: coords.x - region.x, y: coords.y - region.y });
  };

  const handleResizeMouseDown = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIdx(idx);
    setEditAction('resize');
  };

  return (
    <div className="relative flex flex-col items-center w-full bg-slate-900 rounded-[32px] overflow-hidden shadow-[0_32px_64px_rgba(0,0,0,0.5)] border border-slate-800 transition-all">
      <div 
        ref={containerRef}
        className={`relative w-full aspect-video select-none ${isDrawing ? 'cursor-crosshair' : 'cursor-default'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain pointer-events-none"
          onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
          controls={false}
        />
        
        <div className="absolute inset-0 z-0" onClick={() => {
          if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
          }
        }} />

        {blurRegions.map((region, idx) => {
          const isEditing = editingIdx === idx;
          return (
            <div
              key={idx}
              onMouseDown={(e) => handleRegionMouseDown(idx, e)}
              className={`absolute blur-region-item transition-all ${
                isEditing 
                ? 'border-[3px] border-blue-400 bg-blue-500/10 z-30 cursor-move ring-[10px] ring-blue-500/20 shadow-2xl' 
                : 'border-2 border-dashed border-white/40 backdrop-blur-3xl z-20 cursor-pointer hover:border-emerald-400 hover:bg-emerald-400/5'
              } group overflow-visible`}
              style={{
                left: `${region.x}%`,
                top: `${region.y}%`,
                width: `${region.width}%`,
                height: `${region.height}%`,
                backgroundColor: isEditing ? undefined : `rgba(0, 0, 0, ${blurOpacity / 100})`
              }}
            >
              <div className="absolute -top-12 left-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlurRegions(prev => prev.filter((_, i) => i !== idx));
                    setEditingIdx(null);
                  }}
                  className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg text-[11px] text-white font-black shadow-lg"
                >
                  XÓA
                </button>
                {isEditing && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIdx(null);
                    }}
                    className="bg-emerald-500 hover:bg-emerald-600 px-3 py-1 rounded-lg text-[11px] text-white font-black shadow-lg animate-pulse"
                  >
                    XÁC NHẬN
                  </button>
                )}
              </div>

              {isEditing && (
                <div 
                  onMouseDown={(e) => handleResizeMouseDown(idx, e)}
                  className="absolute -bottom-3 -right-3 w-8 h-8 bg-blue-500 cursor-nwse-resize z-50 rounded-full flex items-center justify-center shadow-2xl border-2 border-white transform transition-transform hover:scale-125 active:scale-90"
                >
                  <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-white"></div>
                </div>
              )}

              {activeSub && region === mainBlur && (
                 <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-1">
                    <span 
                      className="text-yellow-300 font-black text-center leading-tight drop-shadow-md" 
                      style={{ 
                        fontSize: `${fontSize * 0.08}vw`, 
                        fontFamily: fontFamily 
                      }}
                    >
                       {activeSub.translatedText || activeSub.originalText}
                    </span>
                 </div>
              )}
            </div>
          );
        })}

        {currentDrag && (
          <div
            className="absolute border-[3px] border-emerald-400 bg-emerald-400/20 z-40 pointer-events-none ring-[12px] ring-emerald-500/10"
            style={{
              left: `${currentDrag.x}%`,
              top: `${currentDrag.y}%`,
              width: `${currentDrag.width}%`,
              height: `${currentDrag.height}%`,
            }}
          />
        )}
      </div>
      
      <div className="w-full p-6 bg-slate-900 border-t border-slate-800 flex flex-wrap gap-8 justify-between items-center relative z-40">
        <div className="flex items-center gap-10">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Thời gian phát</span>
            <div className="flex items-center gap-3">
               <button onClick={() => {
                 if (videoRef.current) {
                   if (videoRef.current.paused) videoRef.current.play();
                   else videoRef.current.pause();
                 }
               }} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all">
                 {videoRef.current?.paused ? (
                   <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M4.516 7.548c0-.442.37-.8.826-.8h.01c.456 0 .825.358.825.8v4.904c0 .442-.37.8-.825.8h-.01c-.456 0-.826-.358-.826-.8V7.548zM8.516 7.548c0-.442.37-.8.826-.8h.01c.456 0 .825.358.825.8v4.904c0 .442-.37.8-.825.8h-.01c-.456 0-.826-.358-.826-.8V7.548z" /><path d="M6.516 12.452v-4.904" /><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>
                 ) : (
                   <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h4z" /></svg>
                 )}
               </button>
               <span className="text-emerald-400 font-mono text-lg font-black">{currentTime.toFixed(2)}s</span>
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Độ đậm layer mờ</span>
            <div className="flex items-center gap-4">
              <input 
                type="range" min="0" max="100" 
                value={blurOpacity} 
                onChange={(e) => setBlurOpacity(Number(e.target.value))}
                className="w-40 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-xs font-black text-slate-400 w-8">{blurOpacity}%</span>
            </div>
          </div>
        </div>

        <button 
          onClick={() => { setEditingIdx(null); setIsDrawing(!isDrawing); }}
          className={`px-8 py-3.5 rounded-2xl text-sm font-black transition-all shadow-xl flex items-center gap-3 ${isDrawing ? 'bg-red-600 text-white scale-105 rotate-1' : 'bg-blue-600 text-white hover:bg-blue-500 hover:scale-[1.02]'}`}
        >
          {isDrawing ? (
            <>
              <svg className="w-5 h-5 animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              HỦY VẼ
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              VẼ VÙNG CHE PHỤ ĐỀ
            </>
          )}
        </button>
      </div>
    </div>
  );
});

export default VideoWorkspace;
