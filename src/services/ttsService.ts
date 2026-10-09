import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
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

type SentenceListener = (index: number, total: number) => void;

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

/** Ước lượng thời lượng đọc (ms) khi chưa tải được file audio. */
const estimateMs = (text: string, speed: number): number => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max((words / ((140 / 60) * speed)) * 1000, 800);
};

class TTSService {
  private currentVoice: VoiceOption = VIETNAMESE_VOICES[0];
  private currentSpeed: number = 1.0;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private progressListeners: ProgressListener[] = [];
  private progressInterval: any = null;
  private estimatedDurationMs: number = 10000;
  private elapsedMs: number = 0;
  private serverIp: string = getDetectedHostIp();
  private serverPort: number = 3000;
  // URL đầy đủ của server online (vd https://user-space.hf.space).
  // Khi có giá trị này, app dùng nó thay vì http://ip:port.
  private serverBaseUrl: string | null = null;
  private activePlayer: AudioPlayer | null = null;
  private isUsingServerAudio: boolean = false;

  // --- Sentence chunking state (PLAN B3: zero-waste dual buffer) ---
  private sentences: string[] = [];
  private sentenceIndex: number = 0;
  private chunkUris: (string | null)[] = [];
  private chunkDurationsMs: (number | null)[] = [];
  private chunkPrefetching: (Promise<string | null> | null)[] = [];
  private playbackId: number = 0;
  private consecutiveFailures: number = 0;
  private onSentenceChange: SentenceListener | null = null;
  private speakOnFinish: (() => void) | null = null;
  private speakOnError: ((e: any) => void) | null = null;

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
    this.serverBaseUrl = null;
  }

  /**
   * Đặt URL đầy đủ của server online, vd "https://quanghung92-audioverse.hf.space".
   * Dùng cho Hugging Face Spaces hoặc bất kỳ server nào có HTTPS.
   */
  public setServerUrl(url: string) {
    let clean = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(clean)) {
      clean = 'https://' + clean;
    }
    this.serverBaseUrl = clean;
  }

  public getServerUrl(): string {
    return this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
  }

  public getServerPort(): number {
    return this.serverPort;
  }

  public async testServerConnection(): Promise<{ success: boolean; ip: string; message: string }> {
    // Nếu đã đặt URL online (HF Spaces...), chỉ test đúng URL đó.
    if (this.serverBaseUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${this.serverBaseUrl}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return { success: true, ip: this.serverBaseUrl, message: `Kết nối thành công! (${data.engine || 'Kokoro'})` };
        }
      } catch (e: any) { /* fall through */ }
      return { success: false, ip: this.serverBaseUrl, message: 'Không kết nối được tới server online' };
    }

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
          this.serverIp = ip;
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

  /**
   * Tách văn bản thành câu. Gom câu quá ngắn (< 5 từ) vào câu trước
   * để ngữ điệu không bị giật cục (theo PLAN B3), nhưng không để
   * chunk gộp vượt quá ~30 từ để vẫn phát nhanh câu đầu.
   */
  public splitSentences(text: string): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const raw = normalized.match(/[^.!?…\n]+[.!?…\n]+|[^.!?…\n]+$/g) || [normalized];
    const merged: string[] = [];
    for (const part of raw) {
      const t = part.trim();
      if (!t) continue;
      const wordCount = t.split(/\s+/).length;
      if (wordCount < 5 && merged.length > 0) {
        const prevWords = merged[merged.length - 1].split(/\s+/).length;
        if (prevWords + wordCount <= 30) {
          merged[merged.length - 1] += ' ' + t;
          continue;
        }
      }
      merged.push(t);
    }
    return merged;
  }

  public getSentenceIndex(): number {
    return this.sentenceIndex;
  }

  public getTotalSentences(): number {
    return this.sentences.length;
  }

  public async speak(
    text: string,
    onFinish?: () => void,
    onError?: (error: any) => void,
    onSentence?: SentenceListener,
    startSentenceIndex: number = 0
  ) {
    await this.stop();

    if (!text || text.trim().length === 0) return;

    this.playbackId += 1;
    const myId = this.playbackId;
    this.isSpeaking = true;
    this.isPaused = false;
    this.speakOnFinish = onFinish || null;
    this.speakOnError = onError || null;
    this.onSentenceChange = onSentence || null;
    this.consecutiveFailures = 0;

    this.sentences = this.splitSentences(text);
    const startIdx = Math.max(0, Math.min(startSentenceIndex, this.sentences.length - 1));
    this.sentenceIndex = startIdx;
    this.chunkUris = new Array(this.sentences.length).fill(null);
    this.chunkDurationsMs = new Array(this.sentences.length).fill(null);
    this.chunkPrefetching = new Array(this.sentences.length).fill(null);

    // Web không có FileSystem.downloadAsync -> dùng giọng hệ thống luôn,
    // tránh 3 lần thử server vô ích rồi mới báo lỗi.
    if (Platform.OS === 'web') {
      this.playViaDeviceSpeech(text, onFinish, onError);
      return;
    }

    // Thử câu đầu tiên qua server. Nếu server chết -> fallback giọng hệ thống.
    const firstUri = await this.fetchChunk(startIdx, myId);
    if (myId !== this.playbackId) return;
    if (!firstUri) {
      this.playViaDeviceSpeech(text, onFinish, onError);
      return;
    }
    this.playChunk(startIdx, myId);
  }

  private chunkUrl(index: number): string {
    const ext = this.currentVoice.id.startsWith('kokoro_') ? 'wav' : 'mp3';
    const text = this.sentences[index];
    const base = this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
    return `${base}/tts.${ext}?text=${encodeURIComponent(text)}&voice=${this.currentVoice.id}&speed=${this.currentSpeed}`;
  }

  private chunkFileUri(index: number, myId: number): string {
    const ext = this.currentVoice.id.startsWith('kokoro_') ? 'wav' : 'mp3';
    const cacheDir = (FileSystem.cacheDirectory as string) || '';
    return `${cacheDir}tts_${myId}_${index}.${ext}`;
  }

  /** Tải 1 câu về máy. Trả về uri file hoặc null nếu lỗi. */
  private async fetchChunk(index: number, myId: number): Promise<string | null> {
    if (myId !== this.playbackId) return null;
    if (this.chunkUris[index]) return this.chunkUris[index];
    if (!this.chunkPrefetching[index]) {
      this.chunkPrefetching[index] = (async () => {
        try {
          const url = this.chunkUrl(index);
          const localFile = this.chunkFileUri(index, myId);
          const result = await FileSystem.downloadAsync(url, localFile);
          if (myId !== this.playbackId) {
            FileSystem.deleteAsync(localFile, { idempotent: true }).catch(() => {});
            return null;
          }
          if (result && result.status === 200) {
            this.chunkUris[index] = result.uri;
            return result.uri;
          }
          return null;
        } catch {
          return null;
        } finally {
          if (myId === this.playbackId) this.chunkPrefetching[index] = null;
        }
      })();
    }
    return this.chunkPrefetching[index];
  }

  /** Nạp gối đầu câu tiếp theo trong lúc câu hiện tại đang phát. */
  private prefetchNext(index: number, myId: number) {
    const next = index + 1;
    if (next < this.sentences.length && !this.chunkUris[next]) {
      this.fetchChunk(next, myId).catch(() => {});
    }
  }

  private async playChunk(index: number, myId: number) {
    if (myId !== this.playbackId) return;
    if (index >= this.sentences.length) {
      this.finishPlayback(myId);
      return;
    }

    this.sentenceIndex = index;
    if (this.onSentenceChange) {
      try {
        this.onSentenceChange(index, this.sentences.length);
      } catch {}
    }

    const uri = await this.fetchChunk(index, myId);
    if (myId !== this.playbackId) return;

    if (!uri) {
      this.consecutiveFailures += 1;
      console.log(`[TTS] Chunk ${index} failed (${this.consecutiveFailures} liên tiếp)`);
      if (this.consecutiveFailures >= 3) {
        this.cleanUp();
        this.notifyProgress(0, 1000, false);
        if (this.speakOnError) this.speakOnError(new Error('Server TTS không phản hồi'));
        return;
      }
      // Bỏ qua câu lỗi, sang câu tiếp theo
      this.playChunk(index + 1, myId);
      return;
    }
    this.consecutiveFailures = 0;

    // Nạp gối đầu câu tiếp theo ngay khi bắt đầu phát câu này
    this.prefetchNext(index, myId);

    try {
      if (setAudioModeAsync) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      }
      // Dọn player cũ
      if (this.activePlayer) {
        try {
          this.activePlayer.remove();
        } catch {}
        this.activePlayer = null;
      }
      this.activePlayer = createAudioPlayer(uri, { updateInterval: 250 });
      if (!this.activePlayer) {
        this.playChunk(index + 1, myId);
        return;
      }
      this.isUsingServerAudio = true;
      const player = this.activePlayer;

      player.addListener('playbackStatusUpdate', (status: any) => {
        if (myId !== this.playbackId || !this.isSpeaking) return;
        const posMs = (status.currentTime || 0) * 1000;
        const durMs = (status.duration || 0) * 1000;
        if (durMs > 0) this.chunkDurationsMs[index] = durMs;
        this.notifyProgress(this.cumulativeMs(index, posMs), this.totalEstimatedMs(), status.playing);
        if (status.didJustFinish) {
          // Zero-waste: xóa ngay file câu vừa đọc xong
          const finishedUri = this.chunkUris[index];
          this.chunkUris[index] = null;
          if (finishedUri) {
            FileSystem.deleteAsync(finishedUri, { idempotent: true }).catch(() => {});
          }
          try {
            player.remove();
          } catch {}
          if (this.activePlayer === player) this.activePlayer = null;
          this.playChunk(index + 1, myId);
        }
      });

      player.play();
    } catch (err) {
      console.log('[TTS] playChunk error:', err);
      this.playChunk(index + 1, myId);
    }
  }

  /** Tổng ms đã nghe = các câu trước + vị trí trong câu hiện tại. */
  private cumulativeMs(currentIndex: number, posInChunkMs: number): number {
    let total = 0;
    for (let i = 0; i < currentIndex; i++) {
      total += this.chunkDurationsMs[i] ?? estimateMs(this.sentences[i], this.currentSpeed);
    }
    return total + posInChunkMs;
  }

  private totalEstimatedMs(): number {
    let total = 0;
    for (let i = 0; i < this.sentences.length; i++) {
      total += this.chunkDurationsMs[i] ?? estimateMs(this.sentences[i], this.currentSpeed);
    }
    return Math.max(total, 1000);
  }

  private finishPlayback(myId: number) {
    if (myId !== this.playbackId) return;
    const total = this.totalEstimatedMs();
    this.cleanUp();
    this.notifyProgress(total, total, false);
    if (this.speakOnFinish) {
      const cb = this.speakOnFinish;
      this.speakOnFinish = null;
      cb();
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
    this.playbackId += 1; // vô hiệu hóa mọi chunk đang tải/phát dở
    const uris = this.chunkUris.filter(Boolean) as string[];
    this.chunkUris = [];
    this.chunkPrefetching = [];
    this.sentences = [];
    // Xóa sạch file tạm còn sót
    for (const uri of uris) {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
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
    if (this.isUsingServerAudio && this.sentences.length > 0) {
      // Tìm câu chứa vị trí ms (dựa trên thời lượng đã biết hoặc ước lượng)
      let acc = 0;
      let targetIndex = 0;
      for (let i = 0; i < this.sentences.length; i++) {
        const d = this.chunkDurationsMs[i] ?? estimateMs(this.sentences[i], this.currentSpeed);
        if (ms < acc + d) {
          targetIndex = i;
          break;
        }
        acc += d;
        targetIndex = i;
      }
      if (targetIndex !== this.sentenceIndex) {
        // Nhảy sang câu khác: phát lại từ câu đó
        const myId = this.playbackId;
        if (this.activePlayer) {
          try {
            this.activePlayer.pause();
            this.activePlayer.remove();
          } catch {}
          this.activePlayer = null;
        }
        this.playChunk(targetIndex, myId);
        return;
      }
      if (this.activePlayer) {
        try {
          const offsetMs = Math.max(0, ms - acc);
          await this.activePlayer.seekTo(offsetMs / 1000);
        } catch (e) {
          console.log('[TTS] seekTo error:', e);
        }
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
