
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { SubtitleEntry, TranslationStyle, TranslationDirection } from "../types";

// Helper for exponential backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error.message?.includes('429') || error.message?.includes('quota') || error.status === 429;
      const isServerError = error.status >= 500;
      
      if (isRateLimit || isServerError) {
        const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Rate limit hit or server error. Retrying in ${Math.round(waitTime)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await sleep(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\n?/, "").replace(/\n?```$/, "");
  cleaned = cleaned.replace(/^```\n?/, "").replace(/\n?```$/, "");
  
  const firstBracket = Math.min(
    cleaned.indexOf('[') === -1 ? Infinity : cleaned.indexOf('['),
    cleaned.indexOf('{') === -1 ? Infinity : cleaned.indexOf('{')
  );
  const lastBracket = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  
  if (firstBracket !== Infinity && lastBracket !== -1) {
    return cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned;
};

const pcmToWav = (base64Pcm: string, sampleRate: number = 24000): string => {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + len, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 1 * 16 / 8, true);
  view.setUint16(32, 1 * 16 / 8, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, len, true);

  const combined = new Uint8Array(44 + len);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(bytes, 44);

  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
};

export const extractSubtitlesFromVideo = async (
  videoBase64: string, 
  direction: TranslationDirection = 'zh-vi'
): Promise<SubtitleEntry[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const sourceLang = direction === 'zh-vi' ? "Chinese" : "Vietnamese";
  
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
          {
            text: `You are a meticulous dialogue extraction tool. 
            Extract ALL dialogues from the provided video in ${sourceLang}. 
            Identify the precise start and end times for each line. 
            Return ONLY a valid JSON array of objects. 
            Each object MUST have: "startTime" (float in seconds), "endTime" (float in seconds), and "originalText" (string).
            Capture everything, do not summarize. Max 50 segments.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              originalText: { type: Type.STRING }
            },
            required: ["startTime", "endTime", "originalText"]
          }
        }
      }
    });

    const jsonText = cleanJson(response.text || "[]");
    const raw = JSON.parse(jsonText);
    return raw.map((item: any, idx: number) => ({
      ...item,
      id: `sub-${idx}-${Date.now()}`,
      translatedText: ""
    }));
  });
};

export const translateSubtitles = async (
  subtitles: SubtitleEntry[], 
  style: TranslationStyle = 'Tự nhiên',
  direction: TranslationDirection = 'zh-vi'
): Promise<SubtitleEntry[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const targetLang = direction === 'zh-vi' ? "Vietnamese" : "Chinese";
  
  const chunkSize = 15;
  const results: any[] = [];
  
  for (let i = 0; i < subtitles.length; i += chunkSize) {
    const chunk = subtitles.slice(i, i + chunkSize);
    const prompt = `Translate to ${targetLang} using the style: ${style}. 
    Ensure cultural context is preserved. Return JSON [{id, translatedText}]. 
    Data: ${JSON.stringify(chunk.map(s => ({ id: s.id, text: s.originalText })))}`;

    const chunkResults = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                translatedText: { type: Type.STRING }
              },
              required: ["id", "translatedText"]
            }
          }
        }
      });
      const jsonText = cleanJson(response.text || "[]");
      return JSON.parse(jsonText);
    });
    results.push(...chunkResults);
  }

  return subtitles.map(sub => {
    const t = results.find((x: any) => x.id === sub.id);
    return { ...sub, translatedText: t ? t.translatedText : sub.translatedText || sub.originalText };
  });
};

export const generateVoiceover = async (text: string, direction: TranslationDirection = 'zh-vi'): Promise<string> => {
  if (!text || text.trim().length === 0) return "";
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const voiceName = direction === 'vi-zh' ? 'Fenrir' : 'Kore'; 
  const stylePrompt = direction === 'vi-zh' 
    ? `Say warmly, professionally and deeply like a mature Chinese man: ${text}`
    : `Say sweetly, warmly and cheerfully like a cute young woman: ${text}`;
  
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: stylePrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        return pcmToWav(part.inlineData.data, 24000);
      }
    }
    return "";
  }, 5); 
};
