
export interface SubtitleEntry {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  originalText: string;
  translatedText: string;
  audioUrl?: string;
}

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  EXTRACTING = 'EXTRACTING',
  TRANSLATING = 'TRANSLATING',
  GENERATING_VOICE = 'GENERATING_VOICE',
  EXPORTING = 'EXPORTING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface HistoryState {
  subtitles: SubtitleEntry[];
  blurRegions: BlurRegion[];
}

export interface VideoQueueItem {
  file: File;
  url: string;
  status: ProcessStatus;
  subtitles: SubtitleEntry[];
  blurRegions: BlurRegion[];
  progress: number;
  fontFamily: string;
  fontSize: number;
  totalSubtitles?: number;
  currentSubtitleIndex?: number;
  processingStartTime?: number;
  history: HistoryState[];
  historyIndex: number;
}

export type TranslationStyle = 
  | 'Hiện đại' 
  | 'Tu tiên' 
  | 'Kinh dị' 
  | 'Cổ đại' 
  | 'Chuyên nghiệp' 
  | 'Học đường' 
  | 'Tình yêu' 
  | 'Tự nhiên';

export type TranslationDirection = 'zh-vi' | 'vi-zh';
