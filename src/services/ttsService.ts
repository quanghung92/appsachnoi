import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, NativeModules } from 'react-native';
import { VoiceOption } from '../types';

/** Thư mục cache audio TTS trên máy (giữ lại giữa các lần nghe để nghe lại offline, không tốn server). */
const AUDIO_CACHE_SUBDIR = 'tts-audio-cache/';
/** Giới hạn cache audio: 2GB. Vượt quá sẽ xóa file cũ nhất (LRU theo mtime). */
const MAX_AUDIO_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

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

export const LOCAL_SERVER_IP = '192.168.110.172';
export const LOCAL_SERVER_PORT = 3000;
export const LOCAL_SERVER_URL = `http://${LOCAL_SERVER_IP}:${LOCAL_SERVER_PORT}`;
export const MODAL_SERVER_URL = 'https://linhsamiu--audioverse-kokoro-api.modal.run';

class TTSService {
  private currentVoice: VoiceOption = VIETNAMESE_VOICES[0];
  private currentSpeed: number = 1.0;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private progressListeners: ProgressListener[] = [];
  private progressInterval: any = null;
  private estimatedDurationMs: number = 10000;
  private elapsedMs: number = 0;
  private serverIp: string = LOCAL_SERVER_IP;
  private serverPort: number = LOCAL_SERVER_PORT;
  private serverBaseUrl: string | null = null;
  private activePlayer: AudioPlayer | null = null;
  private isUsingServerAudio: boolean = false;
  // Chapter-audio mode: phát 1 file MP3 nguyên chương (từ batch server / Drive)
  // thay vì từng câu qua Kokoro. Dùng chung progress listeners của App.
  private chapterMode: boolean = false;
  private chapterOnMsProgress: ((posMs: number, durMs: number) => void) | null = null;
  private chapterLastProgressEmit: number = 0;

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
    this.loadSavedServerSettings();
  }

  private async loadSavedServerSettings() {
    try {
      const savedType = await AsyncStorage.getItem('@audioverse/server_type');
      const savedUrl = await AsyncStorage.getItem('@audioverse/server_url');
      if (savedType === 'cloud' || (savedUrl && savedUrl.includes('modal.run'))) {
        this.serverBaseUrl = MODAL_SERVER_URL;
      } else if (savedType === 'custom' && savedUrl) {
        this.serverBaseUrl = savedUrl;
      } else {
        // Mặc định: Local PC Wi-Fi
        this.serverIp = LOCAL_SERVER_IP;
        this.serverBaseUrl = null;
      }
    } catch {}
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

  public getServerType(): 'local' | 'cloud' | 'custom' {
    if (this.serverBaseUrl === MODAL_SERVER_URL) return 'cloud';
    if (!this.serverBaseUrl) return 'local';
    return 'custom';
  }

  public switchToLocal() {
    this.serverIp = LOCAL_SERVER_IP;
    this.serverBaseUrl = null;
    AsyncStorage.setItem('@audioverse/server_type', 'local').catch(() => {});
    AsyncStorage.removeItem('@audioverse/server_url').catch(() => {});
  }

  public switchToCloud() {
    this.serverBaseUrl = MODAL_SERVER_URL;
    AsyncStorage.setItem('@audioverse/server_type', 'cloud').catch(() => {});
    AsyncStorage.setItem('@audioverse/server_url', MODAL_SERVER_URL).catch(() => {});
  }

  public setServerIp(ip: string) {
    let clean = ip.trim();
    clean = clean.replace(/^https?:\/\//, '').replace(/:3000.*$/, '').replace(/\/.*$/, '');
    this.serverIp = clean;
    this.serverBaseUrl = null;
    AsyncStorage.setItem('@audioverse/server_type', 'local').catch(() => {});
    AsyncStorage.removeItem('@audioverse/server_url').catch(() => {});
  }

  /**
   * Đặt URL tùy chỉnh (dự phòng)
   */
  public setServerUrl(url: string) {
    let clean = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(clean)) {
      clean = 'https://' + clean;
    }
    this.serverBaseUrl = clean;
    if (clean === MODAL_SERVER_URL) {
      AsyncStorage.setItem('@audioverse/server_type', 'cloud').catch(() => {});
    } else {
      AsyncStorage.setItem('@audioverse/server_type', 'custom').catch(() => {});
    }
    AsyncStorage.setItem('@audioverse/server_url', clean).catch(() => {});
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
      // Gộp các câu ngắn (dưới 20 từ) để thời lượng đọc mỗi chunk đủ dài (~8-15s),
      // đảm bảo câu tiếp theo luôn được tải xong trước khi câu hiện tại đọc hết.
      if (merged.length > 0) {
        const prevWords = merged[merged.length - 1].split(/\s+/).length;
        if (prevWords < 20 && prevWords + wordCount <= 45) {
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
    this.prefetchAhead(startIdx, myId);
    this.playChunk(startIdx, myId);
  }

  /**
   * Phát 1 file audio nguyên chương (MP3 từ batch server / Drive đã tải về máy).
   * Dùng chung progress listeners với App (positionMs/durationMs/isSpeaking),
   * nên MiniPlayer/FullPlayer không cần sửa. Hết chương -> onFinish (App tự sang chương tiếp).
   * onMsProgress: callback tiến độ (dùng để lưu ReadingProgress), được throttle ~2s.
   */
  public async playChapterAudio(
    localUri: string,
    onFinish?: () => void,
    onError?: (error: any) => void,
    onMsProgress?: (posMs: number, durMs: number) => void,
    startMs: number = 0
  ) {
    await this.stop();

    this.playbackId += 1;
    const myId = this.playbackId;
    this.isSpeaking = true;
    this.isPaused = false;
    this.chapterMode = true;
    this.chapterOnMsProgress = onMsProgress || null;
    this.chapterLastProgressEmit = 0;
    this.speakOnFinish = onFinish || null;
    this.speakOnError = onError || null;
    this.consecutiveFailures = 0;

    if (Platform.OS === 'web') {
      this.cleanUp();
      if (onError) onError(new Error('Chapter audio chưa hỗ trợ trên web'));
      return;
    }

    try {
      if (setAudioModeAsync) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      }
      this.activePlayer = createAudioPlayer(localUri, { updateInterval: 500 });
      if (!this.activePlayer) {
        throw new Error('Không tạo được audio player');
      }
      this.isUsingServerAudio = true;
      const player = this.activePlayer;

      player.addListener('playbackStatusUpdate', (status: any) => {
        if (myId !== this.playbackId || !this.isSpeaking) return;
        const posMs = (status.currentTime || 0) * 1000;
        const durMs = Math.max((status.duration || 0) * 1000, 1000);
        this.notifyProgress(posMs, durMs, status.playing);
        const now = Date.now();
        if (this.chapterOnMsProgress && now - this.chapterLastProgressEmit > 2000) {
          this.chapterLastProgressEmit = now;
          try {
            this.chapterOnMsProgress(posMs, durMs);
          } catch {}
        }
        if (status.didJustFinish) {
          this.finishPlayback(myId);
        }
      });

      player.play();
      if (startMs > 1000) {
        try {
          await player.seekTo(startMs / 1000);
        } catch {}
      }
      console.log(`[TTS] Đang phát chapter audio: ${localUri.substring(0, 80)}...`);
    } catch (err) {
      console.log('[TTS] playChapterAudio error:', err);
      this.cleanUp();
      this.chapterMode = false;
      if (onError) onError(err);
    }
  }

  /** Đang ở chapter-audio mode (phát MP3 nguyên chương) hay sentence mode (Kokoro từng câu). */
  public isChapterAudioMode(): boolean {
    return this.chapterMode;
  }

  private chunkUrl(index: number): string {
    const ext = this.currentVoice.id.startsWith('kokoro_') ? 'wav' : 'mp3';
    const text = this.sentences[index];
    const base = this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
    return `${base}/tts.${ext}?text=${encodeURIComponent(text)}&voice=${this.currentVoice.id}&speed=${this.currentSpeed}`;
  }

  private audioCacheDir(): string {
    return `${(FileSystem.cacheDirectory as string) || ''}${AUDIO_CACHE_SUBDIR}`;
  }

  private async ensureAudioCacheDir(): Promise<string> {
    const dir = this.audioCacheDir();
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    return dir;
  }

  /**
   * Key cache ổn định theo nội dung câu + giọng + tốc độ.
   * Đổi giọng/tốc độ -> cache miss đúng, không phát nhầm file cũ.
   */
  private async cachePathFor(index: number): Promise<{ path: string; ext: string }> {
    const ext = this.currentVoice.id.startsWith('kokoro_') ? 'wav' : 'mp3';
    const key = `${this.sentences[index]}|${this.currentVoice.id}|${this.currentSpeed}`;
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, key);
    return { path: `${this.audioCacheDir()}${hash}.${ext}`, ext };
  }

  /** Tải 1 câu về máy (dùng cache trên máy nếu có). Trả về uri file hoặc null nếu lỗi. */
  private async fetchChunk(index: number, myId: number): Promise<string | null> {
    if (myId !== this.playbackId) return null;
    if (this.chunkUris[index]) return this.chunkUris[index];
    if (!this.chunkPrefetching[index]) {
      this.chunkPrefetching[index] = (async () => {
        try {
          const dir = await this.ensureAudioCacheDir();
          const { path: cachePath, ext } = await this.cachePathFor(index);
          // Cache hit trên máy -> dùng ngay, không gọi server
          const hit: any = await FileSystem.getInfoAsync(cachePath).catch(() => null);
          if (hit && hit.exists) {
            if (myId !== this.playbackId) return null;
            this.chunkUris[index] = cachePath;
            return cachePath;
          }
          // Cache miss -> tải về file tạm rồi chuyển vào cache
          const url = this.chunkUrl(index);
          const tmpFile = `${dir}tmp_${myId}_${index}.${ext}`;
          console.log(`[TTS] Đang tải câu ${index + 1}/${this.sentences.length}: ${url.substring(0, 85)}...`);
          const result = await FileSystem.downloadAsync(url, tmpFile);
          if (myId !== this.playbackId) {
            FileSystem.deleteAsync(tmpFile, { idempotent: true }).catch(() => {});
            return null;
          }
          if (result && result.status === 200) {
            console.log(`[TTS] Câu ${index + 1} tải thành công!`);
            const exists: any = await FileSystem.getInfoAsync(cachePath).catch(() => null);
            if (exists && exists.exists) {
              await FileSystem.deleteAsync(tmpFile, { idempotent: true }).catch(() => {});
            } else {
              await FileSystem.moveAsync({ from: tmpFile, to: cachePath }).catch(() => {});
            }
            this.chunkUris[index] = cachePath;
            // Dọn cache vượt giới hạn (chạy nền, không chặn phát nhạc)
            this.enforceAudioCacheLimit().catch(() => {});
            return cachePath;
          }
          console.warn(`[TTS] Câu ${index + 1} tải thất bại, HTTP status: ${result?.status}`);
          await FileSystem.deleteAsync(tmpFile, { idempotent: true }).catch(() => {});
          return null;
        } catch (err) {
          console.warn(`[TTS] Câu ${index + 1} lỗi mạng:`, err);
          return null;
        } finally {
          if (myId === this.playbackId) this.chunkPrefetching[index] = null;
        }
      })();
    }
    return this.chunkPrefetching[index];
  }

  /**
   * Giữ tổng dung lượng cache audio <= giới hạn bằng cách xóa file cũ nhất.
   * Dùng mtime làm proxy cho LRU (đủ tốt: sách vừa nghe xong luôn có mtime mới nhất).
   */
  private audioCacheEnforcing = false;

  private async enforceAudioCacheLimit(): Promise<void> {
    if (this.audioCacheEnforcing) return;
    this.audioCacheEnforcing = true;
    try {
      const dir = this.audioCacheDir();
      const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
      const infos: { name: string; size: number; mtime: number }[] = [];
      let total = 0;
      for (const f of files) {
        if (f.startsWith('tmp_')) continue; // bỏ qua file tạm đang tải dở
        const info: any = await FileSystem.getInfoAsync(dir + f).catch(() => null);
        if (info && info.exists && !info.isDirectory) {
          total += info.size || 0;
          infos.push({ name: f, size: info.size || 0, mtime: info.modificationTime || 0 });
        }
      }
      if (total > MAX_AUDIO_CACHE_BYTES) {
        infos.sort((a, b) => a.mtime - b.mtime);
        for (const fi of infos) {
          if (total <= MAX_AUDIO_CACHE_BYTES) break;
          await FileSystem.deleteAsync(dir + fi.name, { idempotent: true }).catch(() => {});
          total -= fi.size;
        }
      }
    } catch {
      // cache là tính năng phụ, không được làm hỏng phát nhạc
    } finally {
      this.audioCacheEnforcing = false;
    }
  }

  /** Dung lượng cache audio hiện tại (bytes) — dùng để hiển thị cho người dùng. */
  public async getAudioCacheSize(): Promise<number> {
    try {
      const dir = this.audioCacheDir();
      const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
      let total = 0;
      for (const f of files) {
        if (f.startsWith('tmp_')) continue;
        const info: any = await FileSystem.getInfoAsync(dir + f).catch(() => null);
        if (info && info.exists && !info.isDirectory) total += info.size || 0;
      }
      return total;
    } catch {
      return 0;
    }
  }

  /** Xóa toàn bộ cache audio trên máy. */
  public async clearAudioCache(): Promise<void> {
    try {
      const dir = this.audioCacheDir();
      const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
      await Promise.all(
        files.map(f => FileSystem.deleteAsync(dir + f, { idempotent: true }).catch(() => {}))
      );
    } catch {}
  }

  /** Nạp gối đầu 2 câu tiếp theo trong lúc câu hiện tại đang phát để buffer luôn đầy. */
  private prefetchAhead(index: number, myId: number) {
    for (let offset = 1; offset <= 2; offset++) {
      const next = index + offset;
      if (next < this.sentences.length && !this.chunkUris[next] && !this.chunkPrefetching[next]) {
        this.fetchChunk(next, myId).catch(() => {});
      }
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

    // Duy trì buffer luôn có sẵn 2 câu tiếp theo
    this.prefetchAhead(index, myId);

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
          // Giữ file audio trong cache trên máy để nghe lại offline / không tốn server.
          // (Trước đây xóa ngay sau khi đọc xong — nay giữ lại, LRU tự dọn khi vượt 2GB.)
          this.chunkUris[index] = null;
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
    this.chapterMode = false;
    this.chapterOnMsProgress = null;
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
    this.chunkUris = [];
    this.chunkPrefetching = [];
    this.sentences = [];
    this.chapterMode = false;
    this.chapterOnMsProgress = null;
    // Không xóa file cache audio nữa — giữ lại trên máy để nghe lại offline,
    // không phải gọi server synth lại (tiết kiệm credit Modal).
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
    // Chapter-audio mode: tua trực tiếp trên file MP3 nguyên chương
    if (this.chapterMode && this.isUsingServerAudio && this.activePlayer) {
      try {
        await this.activePlayer.seekTo(Math.max(0, ms) / 1000);
      } catch (e) {
        console.log('[TTS] seekTo (chapter) error:', e);
      }
      return;
    }
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
