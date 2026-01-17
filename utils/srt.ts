
import { SubtitleEntry } from '../types';

const timestampToSeconds = (srtTimestamp: string): number => {
  const [time, ms] = srtTimestamp.split(',');
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
};

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
};

export const parseSRT = (content: string): SubtitleEntry[] => {
  const entries: SubtitleEntry[] = [];
  const blocks = content.trim().split(/\n\s*\n/);

  blocks.forEach((block, index) => {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timeLine = lines[1];
      const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (match) {
        entries.push({
          id: `srt-${index}-${Date.now()}`,
          startTime: timestampToSeconds(match[1]),
          endTime: timestampToSeconds(match[2]),
          originalText: lines.slice(2).join(' '),
          translatedText: ''
        });
      }
    }
  });

  return entries;
};

export const generateSRT = (entries: SubtitleEntry[]): string => {
  return entries
    .map((entry, index) => {
      return `${index + 1}\n${formatTime(entry.startTime)} --> ${formatTime(entry.endTime)}\n${entry.translatedText || entry.originalText}\n`;
    })
    .join('\n');
};
