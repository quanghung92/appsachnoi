import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { VoiceOption } from '../types';

export const VIETNAMESE_VOICES: VoiceOption[] = [
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng đọc truyền cảm, ấm áp (Khuyên dùng cho truyện & tản văn)',
    sampleText: 'Chào bạn, tôi là Hoài My, giọng đọc AI của AudioVerse.'
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng phát thanh viên trầm ấm, đĩnh đạc (Phù hợp sách kinh doanh & kỹ năng)',
    sampleText: 'Chào bạn, tôi là Nam Minh, chúc bạn có những phút giây nghe sách thú vị.'
  }
];

type ProgressListener = (progress: {
  isSpeaking: boolean;
  positionMs: number;
  durationMs: number;
}) => void;

class TTSService {
  private currentVoice: VoiceOption = VIETNAMESE_VOICES[0];
  private currentSpeed: number = 1.0;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private progressListeners: ProgressListener[] = [];
  private progressInterval: any = null;
  private estimatedDurationMs: number = 10000;
  private elapsedMs: number = 0;
  private availableVnVoiceId: string | null = null;

  constructor() {
    this.detectVoices();
  }

  private async detectVoices() {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const vnVoice = voices.find(
        v => v.language && (v.language.toLowerCase().startsWith('vi') || v.language.includes('VN'))
      );
      if (vnVoice) {
        this.availableVnVoiceId = vnVoice.identifier;
        console.log('[TTS] Found native VN voice:', vnVoice.identifier, vnVoice.name);
      }
    } catch (e) {
      console.log('[TTS] getAvailableVoicesAsync error:', e);
    }
  }

  public getVoices(): VoiceOption[] {
    return VIETNAMESE_VOICES;
  }

  public getCurrentVoice(): VoiceOption {
    return this.currentVoice;
  }

  public setVoice(voice: VoiceOption) {
    this.currentVoice = voice;
  }

  public setSpeed(speed: number) {
    this.currentSpeed = speed;
  }

  public getSpeed(): number {
    return this.currentSpeed;
  }

  public addProgressListener(listener: ProgressListener) {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter(l => l !== listener);
    };
  }

  private notifyProgress(posMs: number, durMs: number, isSpeaking: boolean) {
    this.progressListeners.forEach(listener => {
      listener({ isSpeaking, positionMs: posMs, durationMs: durMs });
    });
  }

  public async speak(
    text: string,
    onFinish?: () => void,
    onError?: (error: any) => void
  ) {
    await this.stop();

    if (!text || text.trim().length === 0) return;

    this.isSpeaking = true;
    this.isPaused = false;

    // Calculate approximate duration for UI slider
    const wordCount = text.split(/\s+/).length;
    const wordsPerSec = (150 / 60) * this.currentSpeed;
    const totalSecs = Math.max(wordCount / wordsPerSec, 4);
    this.estimatedDurationMs = totalSecs * 1000;
    this.elapsedMs = 0;

    // Progress tick
    this.progressInterval = setInterval(() => {
      if (this.isSpeaking && !this.isPaused) {
        this.elapsedMs += 250;
        if (this.elapsedMs > this.estimatedDurationMs) {
          this.elapsedMs = this.estimatedDurationMs;
        }
        this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, true);
      }
    }, 250);

    try {
      const options: Speech.SpeechOptions = {
        language: 'vi-VN',
        pitch: this.currentVoice.gender === 'female' ? 1.05 : 0.9,
        rate: Math.min(Math.max(this.currentSpeed * 0.9, 0.4), 1.8),
        onDone: () => {
          console.log('[TTS] Finished speaking');
          this.cleanUp();
          this.notifyProgress(this.estimatedDurationMs, this.estimatedDurationMs, false);
          if (onFinish) onFinish();
        },
        onStopped: () => {
          console.log('[TTS] Stopped');
          this.cleanUp();
        },
        onError: (err) => {
          console.log('[TTS] Speak error:', err);
          this.cleanUp();
          if (onError) onError(err);
        }
      };

      if (this.availableVnVoiceId) {
        options.voice = this.availableVnVoiceId;
      }

      console.log('[TTS] Calling Speech.speak for text length:', text.length);
      Speech.speak(text, options);
    } catch (err) {
      console.log('[TTS] Speech exception:', err);
      this.cleanUp();
      if (onError) onError(err);
    }
  }

  public async pause() {
    this.isPaused = true;
    try {
      await Speech.pause();
    } catch (e) {}
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, false);
  }

  public async resume() {
    this.isPaused = false;
    try {
      await Speech.resume();
    } catch (e) {}
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, true);
  }

  public async stop() {
    this.cleanUp();
    try {
      await Speech.stop();
    } catch (e) {}
    this.notifyProgress(0, this.estimatedDurationMs || 1000, false);
  }

  private cleanUp() {
    this.isSpeaking = false;
    this.isPaused = false;
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const ttsService = new TTSService();
