import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { VoiceOption } from '../types';

export const VIETNAMESE_VOICES: VoiceOption[] = [
  {
    id: 'kokoro_storyvert',
    name: 'Storyvert (Kokoro AI)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Chuyên đọc truyện đêm khuya, tiểu thuyết & truyện chữ (Giọng offline siêu nhẹ)',
    sampleText: 'Đêm đã về khuya, gió rít qua khe cửa sổ. Tiếng bước chân khe khẽ vang lên trên hành lang vắng lặng.'
  },
  {
    id: 'kokoro_diem_trinh',
    name: 'Diễm Trinh (Kokoro AI)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng nữ trong trẻo, nhẹ nhàng, điềm tĩnh (Phù hợp tản văn & sách kỹ năng)',
    sampleText: 'Chào bạn, tôi là Diễm Trinh, giọng đọc AI tự nhiên của Kokoro Vietnamese.'
  },
  {
    id: 'kokoro_hung_thinh',
    name: 'Hưng Thịnh (Kokoro AI)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng nam trầm ấm, truyền cảm, hào hùng (Phù hợp truyện tiên hiệp & lịch sử)',
    sampleText: 'Ba mươi năm Hà Đông, ba mươi năm Hà Tây, đừng khinh thiếu niên nghèo!'
  },
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Edge Neural)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng phát thanh viên nữ ngọt ngào, luyến láy mượt mà của Microsoft',
    sampleText: 'Chào bạn, tôi là Hoài My, chúc bạn có những phút giây nghe sách thư giãn.'
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Edge Neural)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng phát thanh viên nam dõng dạc, đĩnh đạc của Microsoft',
    sampleText: 'Chào bạn, tôi là Nam Minh, chúc bạn tiếp thu được nhiều bài học bổ ích từ cuốn sách này.'
  }
];

type ProgressListener = (progress: {
  isSpeaking: boolean;
  positionMs: number;
  durationMs: number;
}) => void;

import { NativeModules } from 'react-native';

const getDetectedHostIp = (): string => {
  try {
    const scriptURL = (NativeModules.SourceCode as any)?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^:\/]+)/);
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        return match[1];
      }
    }
  } catch (e) {}
  return '192.168.110.172';
};

class TTSService {
  private currentVoice: VoiceOption = VIETNAMESE_VOICES[0]; // Default to Storyvert
  private currentSpeed: number = 1.0;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private progressListeners: ProgressListener[] = [];
  private progressInterval: any = null;
  private estimatedDurationMs: number = 10000;
  private elapsedMs: number = 0;
  private serverIp: string = getDetectedHostIp();
  private serverPort: number = 3000;
  private activePlayer: AudioPlayer | null = null;
  private isUsingServerAudio: boolean = false;

  constructor() {
    this.initAudioMode();
  }

  private async initAudioMode() {
    try {
      if (setAudioModeAsync) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
        });
      }
    } catch (e) {
      console.log('[TTS] Audio mode init warning:', e);
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

  public getServerIp(): string {
    return this.serverIp;
  }

  public setServerIp(ip: string) {
    let clean = ip.trim();
    clean = clean.replace(/^https?:\/\//, '').replace(/:3000.*$/, '').replace(/\/.*$/, '');
    this.serverIp = clean;
  }

  public async testServerConnection(): Promise<{ success: boolean; ip: string; message: string }> {
    // Try current IP first, then fallback to 192.168.110.172 if different
    const candidateIps = Array.from(new Set([this.serverIp, '192.168.110.172', getDetectedHostIp()]));

    for (const ip of candidateIps) {
      try {
        const url = `http://${ip}:${this.serverPort}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          this.serverIp = ip; // Auto-update to working IP
          return {
            success: true,
            ip: this.serverIp,
            message: `Kết nối thành công! (${data.engine || 'Kokoro'})`
          };
        }
      } catch (e: any) {
        // try next candidate
      }
    }

    return {
      success: false,
      ip: this.serverIp,
      message: 'Không tìm thấy server trên mạng Wi-Fi'
    };
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

    // Try playing through Kokoro / Edge server first if available
    const playedViaServer = await this.tryPlayViaServer(text, onFinish, onError);
    if (playedViaServer) {
      return;
    }

    // Fallback to on-device Speech engine
    this.playViaDeviceSpeech(text, onFinish, onError);
  }

  private async tryPlayViaServer(
    text: string,
    onFinish?: () => void,
    onError?: (error: any) => void
  ): Promise<boolean> {
    try {
      const ext = this.currentVoice.id.startsWith('kokoro_') ? 'wav' : 'mp3';
      const audioUrl = `http://${this.serverIp}:${this.serverPort}/tts.${ext}?text=${encodeURIComponent(text)}&voice=${this.currentVoice.id}&speed=${this.currentSpeed}`;
      const localFile = `${FileSystem.cacheDirectory}tts_${Date.now()}.${ext}`;

      console.log('[TTS] Fetching audio from server:', audioUrl);
      const downloadResult = await FileSystem.downloadAsync(audioUrl, localFile);

      if (!downloadResult || downloadResult.status !== 200) {
        console.log('[TTS] Server returned HTTP', downloadResult?.status);
        return false;
      }

      console.log('[TTS] Audio downloaded successfully to:', downloadResult.uri);

      if (setAudioModeAsync) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
        });
      }

      this.activePlayer = createAudioPlayer(downloadResult.uri, { updateInterval: 250 });
      if (!this.activePlayer) {
        return false;
      }

      this.isUsingServerAudio = true;

      this.activePlayer.addListener('playbackStatusUpdate', (status: any) => {
        if (!this.isSpeaking) return;

        const posMs = (status.currentTime || 0) * 1000;
        const durMs = (status.duration || 1) * 1000;
        this.notifyProgress(posMs, durMs, status.playing);

        if (status.didJustFinish) {
          this.cleanUp();
          this.notifyProgress(durMs, durMs, false);
          FileSystem.deleteAsync(downloadResult.uri, { idempotent: true }).catch(() => {});
          if (onFinish) onFinish();
        }
      });

      this.activePlayer.play();
      return true;
    } catch (err) {
      console.log('[TTS] Server audio failed, falling back to on-device Speech:', err);
      this.isUsingServerAudio = false;
      this.activePlayer = null;
      return false;
    }
  }

  private playViaDeviceSpeech(
    text: string,
    onFinish?: () => void,
    onError?: (error: any) => void
  ) {
    const wordCount = text.split(/\s+/).length;
    const wordsPerSec = (140 / 60) * this.currentSpeed;
    const totalSecs = Math.max(wordCount / wordsPerSec, 4);
    this.estimatedDurationMs = totalSecs * 1000;
    this.elapsedMs = 0;

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
      Speech.speak(text, {
        language: 'vi-VN',
        pitch: this.currentVoice.gender === 'female' ? 1.08 : 0.88,
        rate: Math.min(Math.max(this.currentSpeed * 0.88, 0.4), 1.8),
        onDone: () => {
          this.cleanUp();
          this.notifyProgress(this.estimatedDurationMs, this.estimatedDurationMs, false);
          if (onFinish) onFinish();
        },
        onStopped: () => {
          this.cleanUp();
        },
        onError: (err) => {
          this.cleanUp();
          if (onError) onError(err);
        }
      });
    } catch (err) {
      this.cleanUp();
      if (onError) onError(err);
    }
  }

  public async pause() {
    this.isPaused = true;
    if (this.isUsingServerAudio && this.activePlayer) {
      try {
        this.activePlayer.pause();
      } catch (e) {}
    } else {
      try {
        await Speech.pause();
      } catch (e) {}
    }
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, false);
  }

  public async resume() {
    this.isPaused = false;
    if (this.isUsingServerAudio && this.activePlayer) {
      try {
        this.activePlayer.play();
      } catch (e) {}
    } else {
      try {
        await Speech.resume();
      } catch (e) {}
    }
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, true);
  }

  public async stop() {
    this.cleanUp();
    if (this.activePlayer) {
      try {
        this.activePlayer.pause();
        this.activePlayer.remove();
      } catch (e) {}
      this.activePlayer = null;
    }
    this.isUsingServerAudio = false;
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

  public isPausedState(): boolean {
    return this.isPaused;
  }

  public setNowPlaying(title: string, subtitle?: string) {
    // Can be used for lock screen / notification media controls
  }

  public async seekTo(ms: number) {
    if (this.isUsingServerAudio && this.activePlayer) {
      try {
        const sec = Math.max(0, ms / 1000);
        await this.activePlayer.seekTo(sec);
      } catch (e) {
        console.log('[TTS] seekTo error:', e);
      }
    }
    this.elapsedMs = ms;
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, this.isSpeaking && !this.isPaused);
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const ttsService = new TTSService();

