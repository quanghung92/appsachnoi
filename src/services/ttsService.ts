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
    id: 'duc_an',
    name: 'Đức An (Kokoro AI)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng nam truyền cảm, phong cách kể chuyện kiếm hiệp & tiểu thuyết, tốc độ siêu tốc (< 1.6s)',
    sampleText: 'Đêm đã về khuya, gió rít qua khe cửa sổ. Tiếng bước chân khe khẽ vang lên trên hành lang vắng lặng.'
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
type SentencesLoadedListener = (sentences: string[]) => void;

const getDetectedHostIp = (): string => {
  try {
    const scriptURL = (NativeModules.SourceCode as any)?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^:\/]+)/);
      if (match && match[1]) {
        const host = match[1];
        // Chỉ chấp nhận địa chỉ IP hợp lệ, bỏ qua domain tunnel (như exp.direct, ngrok)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && host !== '127.0.0.1') {
          return host;
        }
      }
    }
  } catch {}
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
export const DEFAULT_TUNNEL_URL = 'https://nasty-wings-unite.loca.lt';

// Presets nhạc nền thư giãn (nhẹ nhàng, lặp mượt mà)
export const DEFAULT_BGM_URL = 'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg';
export const BGM_TRACKS = [
  { id: 'zen_piano', name: 'Thiền định & Piano', url: 'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg' },
  { id: 'soft_stream', name: 'Suối chảy róc rách', url: 'https://actions.google.com/sounds/v1/water/stream_water.ogg' },
  { id: 'night_crickets', name: 'Đêm hè yên tĩnh', url: 'https://actions.google.com/sounds/v1/ambiences/crickets_night.ogg' },
];

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
  private webAudio: any = null;
  private webBlobUrl: string | null = null;
  private isUsingServerAudio: boolean = false;
  // Chapter-audio mode: phát 1 file MP3 nguyên chương (từ batch server / Drive)
  // thay vì từng câu qua Kokoro. Dùng chung progress listeners của App.
  private chapterMode: boolean = false;
  private chapterOnMsProgress: ((posMs: number, durMs: number) => void) | null = null;
  private chapterLastProgressEmit: number = 0;
  private chapterDurationMs: number = 0;

  // --- Sentence chunking state (PLAN B3: zero-waste dual buffer) ---
  private sentences: string[] = [];
  private sentenceIndex: number = 0;
  private chunkUris: (string | null)[] = [];
  private chunkDurationsMs: (number | null)[] = [];
  private chunkPrefetching: (Promise<string | null> | null)[] = [];
  private playbackId: number = 0;
  private consecutiveFailures: number = 0;
  private onSentenceChange: SentenceListener | null = null;
  private onSentencesLoadedCallbacks: SentencesLoadedListener[] = [];
  private speakOnFinish: (() => void) | null = null;
  private speakOnError: ((e: any) => void) | null = null;

  // --- BƯỚC 3: Ping-Pong Dual Player State (A/B Gapless 0ms) ---
  private playerSlotA: AudioPlayer | null = null;
  private playerSlotB: AudioPlayer | null = null;
  private webAudioSlotA: any = null;
  private webAudioSlotB: any = null;
  private activeSlot: 'A' | 'B' = 'A';
  private preloadedIndex: number = -1;

  // --- BƯỚC 3: Kênh Nhạc Nền (BGM Loop Player & Audio Ducking) ---
  private bgmPlayer: AudioPlayer | null = null;
  private webBgmAudio: any = null;
  private bgmEnabled: boolean = false;
  private bgmVolume: number = 0.35; // Âm lượng cơ bản 35%
  private voiceVolume: number = 1.0;
  private bgmTrackUrl: string = DEFAULT_BGM_URL;
  private isDucked: boolean = false;

  // --- BƯỚC 3: Live Streaming Session State ---
  private currentSessionId: string | null = null;
  private isLiveStreamingMode: boolean = false;

  constructor() {
    this.initAudioMode();
    this.loadSavedServerSettings();
  }

  private async loadSavedServerSettings() {
    try {
      const savedType = await AsyncStorage.getItem('@audioverse/server_type');
      const savedUrl = await AsyncStorage.getItem('@audioverse/server_url');
      // Tự động xóa cài đặt cloud cũ của Kokoro modal.run
      if (savedType === 'cloud' || (savedUrl && savedUrl.includes('modal.run'))) {
        await AsyncStorage.removeItem('@audioverse/server_type');
        await AsyncStorage.removeItem('@audioverse/server_url');
        this.serverIp = LOCAL_SERVER_IP;
        this.serverBaseUrl = null;
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
    if (this.webAudio) {
      try {
        this.webAudio.playbackRate = speed;
      } catch {}
    }
  }

  public getSpeed(): number {
    return this.currentSpeed;
  }

  public getServerIp(): string {
    return this.serverIp;
  }

  public getServerType(): 'local' | 'custom' {
    if (!this.serverBaseUrl) return 'local';
    return 'custom';
  }

  public switchToLocal() {
    this.serverIp = LOCAL_SERVER_IP;
    this.serverBaseUrl = null;
    AsyncStorage.setItem('@audioverse/server_type', 'local').catch(() => {});
    AsyncStorage.removeItem('@audioverse/server_url').catch(() => {});
  }

  public switchToTunnel() {
    this.serverBaseUrl = DEFAULT_TUNNEL_URL;
    AsyncStorage.setItem('@audioverse/server_type', 'tunnel').catch(() => {});
    AsyncStorage.setItem('@audioverse/server_url', DEFAULT_TUNNEL_URL).catch(() => {});
  }

  public switchToCloud() {
    // Tương thích ngược: chuyển về tunnel
    this.switchToTunnel();
  }

  public setServerIp(ip: string) {
    let clean = ip.trim();
    clean = clean.replace(/^https?:\/\//, '').replace(/:3000.*$/, '').replace(/\/.*$/, '');
    this.serverIp = clean || LOCAL_SERVER_IP;
    this.serverBaseUrl = null;
    AsyncStorage.setItem('@audioverse/server_type', 'local').catch(() => {});
    AsyncStorage.removeItem('@audioverse/server_url').catch(() => {});
  }

  /**
   * Đặt URL tùy chỉnh (dự phòng ngrok, tunnel hoặc server online)
   */
  public setServerUrl(url: string) {
    let clean = url.trim().replace(/\/+$/, '');
    if (!clean) {
      this.switchToLocal();
      return;
    }
    if (!/^https?:\/\//.test(clean)) {
      clean = 'http://' + clean;
    }
    this.serverBaseUrl = clean;
    AsyncStorage.setItem('@audioverse/server_type', 'custom').catch(() => {});
    AsyncStorage.setItem('@audioverse/server_url', clean).catch(() => {});
  }

  public getServerUrl(): string {
    return this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
  }

  public getServerPort(): number {
    return this.serverPort;
  }

  public async testServerConnection(): Promise<{ success: boolean; ip: string; message: string }> {
    // 1. Nếu đã đặt URL tùy chỉnh thủ công:
    if (this.serverBaseUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${this.serverBaseUrl}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return {
            success: true,
            ip: this.serverBaseUrl,
            message: `Kết nối thành công! (${data.engine || 'VieNeu-TTS'})`
          };
        }
      } catch {}
    }

    // 2. Thử lần lượt: Local IP Wi-Fi -> Nếu không được, thử Tunnel online (dành cho 4G hoặc máy tính bật VPN)
    const hostIp = getDetectedHostIp();
    const candidateEndpoints = [
      `http://${this.serverIp}:${this.serverPort}`,
      `http://${LOCAL_SERVER_IP}:${this.serverPort}`,
      `http://${hostIp}:${this.serverPort}`,
      DEFAULT_TUNNEL_URL,
    ];

    const uniqueEndpoints = Array.from(new Set(candidateEndpoints)).filter(Boolean);

    for (const endpoint of uniqueEndpoints) {
      try {
        const url = `${endpoint}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (endpoint.startsWith('https://')) {
            this.serverBaseUrl = endpoint;
          } else {
            const match = endpoint.match(/^http:\/\/([^:]+)/);
            if (match && match[1]) this.serverIp = match[1];
            this.serverBaseUrl = null;
          }
          return {
            success: true,
            ip: endpoint,
            message: `Kết nối thành công! (${data.engine || 'VieNeu-TTS'})`
          };
        }
      } catch {}
    }

    return {
      success: false,
      ip: this.getServerUrl(),
      message: `Chưa kết nối được máy chủ AI (${this.getServerUrl()})`
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

  public getSentences(): string[] {
    return this.sentences;
  }

  public addOnSentencesLoadedListener(callback: SentencesLoadedListener) {
    this.onSentencesLoadedCallbacks.push(callback);
    if (this.sentences.length > 0) {
      try {
        callback(this.sentences);
      } catch {}
    }
    return () => {
      this.onSentencesLoadedCallbacks = this.onSentencesLoadedCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifySentencesLoaded(sentences: string[]) {
    this.onSentencesLoadedCallbacks.forEach(cb => {
      try {
        cb(sentences);
      } catch {}
    });
  }

  // --- BƯỚC 3: Kênh Nhạc Nền (BGM Controls & Audio Ducking) ---

  public isBgmEnabled(): boolean {
    return this.bgmEnabled;
  }

  public setBgmEnabled(enabled: boolean) {
    this.bgmEnabled = enabled;
    if (enabled) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  public getBgmVolume(): number {
    return this.bgmVolume;
  }

  public setBgmVolume(volume: number) {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    this.applyBgmVolume();
  }

  public getVoiceVolume(): number {
    return this.voiceVolume;
  }

  public setVoiceVolume(volume: number) {
    this.voiceVolume = Math.max(0, Math.min(1, volume));
  }

  public getBgmTrack(): string {
    return this.bgmTrackUrl;
  }

  public setBgmTrack(url: string) {
    this.bgmTrackUrl = url;
    if (this.bgmEnabled) {
      this.startBgm();
    }
  }

  /**
   * Audio Ducking: Khi giọng đọc bắt đầu phát -> hạ volume BGM còn 12-15%.
   * Khi nghỉ giữa các câu hoặc dừng -> nâng lại 100% volume BGM đã chọn.
   */
  private duckBgm(duck: boolean) {
    this.isDucked = duck;
    this.applyBgmVolume();
  }

  private applyBgmVolume() {
    if (!this.bgmEnabled) return;
    const targetVol = this.isDucked ? this.bgmVolume * 0.15 : this.bgmVolume;
    if (this.webBgmAudio) {
      try {
        this.webBgmAudio.volume = targetVol;
      } catch {}
    }
    // Mobile player volume (nếu platform hỗ trợ)
    if (this.bgmPlayer && (this.bgmPlayer as any).setVolumeAsync) {
      try {
        (this.bgmPlayer as any).setVolumeAsync(targetVol);
      } catch {}
    }
  }

  public async startBgm() {
    if (!this.bgmEnabled || !this.bgmTrackUrl) return;
    try {
      if (Platform.OS === 'web') {
        if (this.webBgmAudio) {
          try {
            this.webBgmAudio.pause();
          } catch {}
          this.webBgmAudio = null;
        }
        const audio = new Audio(this.bgmTrackUrl);
        audio.loop = true;
        const targetVol = this.isDucked ? this.bgmVolume * 0.15 : this.bgmVolume;
        audio.volume = targetVol;
        audio.play().catch(e => console.log('[TTS BGM] Web auto-play deferred:', e));
        this.webBgmAudio = audio;
      } else {
        if (this.bgmPlayer) {
          try {
            this.bgmPlayer.remove();
          } catch {}
          this.bgmPlayer = null;
        }
        this.bgmPlayer = createAudioPlayer(this.bgmTrackUrl, { updateInterval: 1000 });
        if (this.bgmPlayer) {
          if ((this.bgmPlayer as any).setLoopingAsync) {
            await (this.bgmPlayer as any).setLoopingAsync(true);
          }
          this.applyBgmVolume();
          this.bgmPlayer.play();
        }
      }
    } catch (e) {
      console.log('[TTS BGM] startBgm error:', e);
    }
  }

  public stopBgm() {
    if (this.webBgmAudio) {
      try {
        this.webBgmAudio.pause();
        this.webBgmAudio.src = '';
      } catch {}
      this.webBgmAudio = null;
    }
    if (this.bgmPlayer) {
      try {
        this.bgmPlayer.pause();
        this.bgmPlayer.remove();
      } catch {}
      this.bgmPlayer = null;
    }
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

    // Thử câu đầu tiên qua server. Nếu server chết -> thông báo lỗi rõ ràng cho người dùng, không chạy giả lập.
    const firstUri = await this.fetchChunk(startIdx, myId);
    if (myId !== this.playbackId) return;
    if (!firstUri) {
      this.cleanUp();
      const errorMsg = `Không thể kết nối máy chủ Kokoro (${this.getServerUrl()}). Hãy kiểm tra Cloudflare Tunnel hoặc server!`;
      console.warn(`[TTS] ${errorMsg}`);
      if (this.speakOnError) {
        this.speakOnError(new Error(errorMsg));
      }
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
    startMs: number = 0,
    knownDurationMs: number = 0
  ) {
    await this.stop();

    this.playbackId += 1;
    const myId = this.playbackId;
    this.isSpeaking = true;
    this.isPaused = false;
    this.chapterMode = true;
    this.chapterDurationMs = (knownDurationMs && knownDurationMs > 0) ? knownDurationMs : 0;
    this.chapterOnMsProgress = onMsProgress || null;
    this.chapterLastProgressEmit = 0;
    this.speakOnFinish = onFinish || null;
    this.speakOnError = onError || null;
    this.consecutiveFailures = 0;

    if (Platform.OS === 'web') {
      try {
        if (this.webAudio) {
          try {
            this.webAudio.pause();
            this.webAudio.src = '';
          } catch {}
          this.webAudio = null;
        }
        if (this.webBlobUrl) {
          try {
            URL.revokeObjectURL(this.webBlobUrl);
          } catch {}
          this.webBlobUrl = null;
        }

        // Tự động chuyển link Google Drive sang proxy stream trên Web để tránh lỗi CORS/CORP
        let playSrc = localUri;
        if (playSrc.includes('drive.google.com') || playSrc.includes('drive.usercontent.google.com')) {
          const host =
            typeof window !== 'undefined' && window.location.hostname
              ? window.location.hostname
              : 'localhost';
          const idMatch = playSrc.match(/[?&]id=([a-zA-Z0-9_-]+)/);
          if (idMatch) {
            playSrc = `http://${host}:3001/drive-stream?id=${idMatch[1]}`;
          } else {
            playSrc = `http://${host}:3001/drive-stream?url=${encodeURIComponent(playSrc)}`;
          }
        }

        console.log(`[TTS] Đang phát chapter audio trên Web: ${playSrc}`);
        const audio = new Audio(playSrc);
        this.webAudio = audio;
        this.isUsingServerAudio = true;
        this.chapterMode = true;

        const getDurMs = (posMs: number = 0) => {
          if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
            this.chapterDurationMs = Math.floor(audio.duration * 1000);
            return this.chapterDurationMs;
          }
          if (this.chapterDurationMs > 0) {
            return Math.max(this.chapterDurationMs, posMs);
          }
          return Math.max(posMs + 1000, 60000);
        };

        const emitWebProgress = (isPlayingState: boolean) => {
          if (myId !== this.playbackId) return;
          const posMs = Math.floor((audio.currentTime || 0) * 1000);
          const durMs = getDurMs(posMs);
          this.notifyProgress(posMs, Math.max(durMs, posMs), isPlayingState);
          const now = Date.now();
          if (this.chapterOnMsProgress && now - this.chapterLastProgressEmit > 1500) {
            this.chapterLastProgressEmit = now;
            try {
              this.chapterOnMsProgress(posMs, durMs);
            } catch {}
          }
        };

        audio.onplay = () => {
          if (myId !== this.playbackId) return;
          this.isSpeaking = true;
          this.isPaused = false;
          emitWebProgress(true);
        };

        audio.onplaying = () => {
          if (myId !== this.playbackId) return;
          this.isSpeaking = true;
          this.isPaused = false;
          emitWebProgress(true);
        };

        audio.onpause = () => {
          if (myId !== this.playbackId) return;
          this.isPaused = true;
          emitWebProgress(false);
        };

        audio.ondurationchange = () => {
          if (myId !== this.playbackId) return;
          emitWebProgress(!audio.paused);
        };

        audio.onloadedmetadata = () => {
          if (myId !== this.playbackId) return;
          emitWebProgress(!audio.paused);
        };

        audio.oncanplay = () => {
          if (myId !== this.playbackId) return;
          emitWebProgress(!audio.paused);
        };

        audio.ontimeupdate = () => {
          if (myId !== this.playbackId) return;
          emitWebProgress(!audio.paused);
        };

        audio.onended = () => {
          this.finishPlayback(myId);
        };

        audio.onerror = (e) => {
          console.log('[TTS] Web chapter audio error:', e);
          this.cleanUp();
          this.chapterMode = false;
          if (onError) onError(e);
        };

        if (startMs > 1000) {
          audio.currentTime = startMs / 1000;
        }

        audio.playbackRate = this.currentSpeed;
        await audio.play();
        this.isSpeaking = true;
        this.isPaused = false;
        emitWebProgress(true);

        console.log(`[TTS] Đang phát chapter audio trên Web thành công!`);
        return;
      } catch (webErr) {
        console.log('[TTS] Web playChapterAudio init error:', webErr);
        this.cleanUp();
        this.chapterMode = false;
        if (onError) onError(webErr);
        return;
      }
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
        const rawDur = (status.duration || 0) * 1000;
        let durMs = !isNaN(rawDur) && isFinite(rawDur) && rawDur > 0 ? rawDur : this.chapterDurationMs;
        if (!durMs || durMs <= 0) durMs = Math.max(posMs + 1000, 60000);
        this.chapterDurationMs = durMs;
        this.notifyProgress(posMs, Math.max(durMs, posMs), status.playing);
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

  public getBaseUrl(): string {
    const base = this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
    return base.trim().replace(/\/+$/, '');
  }

  private chunkUrl(index: number): string {
    const base = this.getBaseUrl();
    if (this.isLiveStreamingMode && this.currentSessionId) {
      return `${base}/api/stream/chunk?sess=${encodeURIComponent(this.currentSessionId)}&idx=${index}`;
    }
    const ext = (this.currentVoice.id.startsWith('vieneu_') || this.currentVoice.id.startsWith('kokoro_') || this.currentVoice.id === 'duc_an') ? 'wav' : 'mp3';
    const text = this.sentences[index] || '';
    return `${base}/tts.${ext}?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(this.currentVoice.id)}&speed=${this.currentSpeed}`;
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
   * Key cache ổn định theo nội dung câu + giọng + tốc độ hoặc session stream.
   * Đổi giọng/tốc độ -> cache miss đúng, không phát nhầm file cũ.
   */
  private async cachePathFor(index: number): Promise<{ path: string; ext: string }> {
    if (this.isLiveStreamingMode && this.currentSessionId) {
      const key = `stream_${this.currentSessionId}_${index}`;
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, key);
      return { path: `${this.audioCacheDir()}${hash}.mp3`, ext: 'mp3' };
    }
    const ext = (this.currentVoice.id.startsWith('vieneu_') || this.currentVoice.id.startsWith('kokoro_') || this.currentVoice.id === 'duc_an') ? 'wav' : 'mp3';
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

  /**
   * BƯỚC 3: Ping-Pong Dual Player Engine (A/B Gapless 0ms).
   * Trong lúc Slot A đang đọc câu hiện tại, Slot B đã nạp sẵn câu tiếp theo.
   * Khi Slot A kết thúc, Slot B được kích hoạt ngay trong 0ms!
   */
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

    // Hạ âm lượng nhạc nền khi bắt đầu đọc (Audio Ducking 15%)
    this.duckBgm(true);

    // Kênh Web: Sử dụng Ping-Pong qua 2 thẻ Audio A và B
    if (Platform.OS === 'web') {
      await this.playChunkWebPingPong(index, myId);
      return;
    }

    // Kênh Native (iOS / Android): Sử dụng Dual AudioPlayer A/B
    await this.playChunkNativePingPong(index, myId);
  }

  private async playChunkWebPingPong(index: number, myId: number) {
    const url = this.chunkUrl(index);
    try {
      const currentSlot = this.activeSlot;
      const nextSlot = currentSlot === 'A' ? 'B' : 'A';

      let audio = currentSlot === 'A' ? this.webAudioSlotA : this.webAudioSlotB;
      if (!audio) {
        audio = new Audio(url);
        if (currentSlot === 'A') this.webAudioSlotA = audio;
        else this.webAudioSlotB = audio;
      } else {
        audio.src = url;
      }
      this.webAudio = audio;
      this.isUsingServerAudio = true;

      audio.onended = () => {
        if (myId !== this.playbackId) return;
        this.activeSlot = nextSlot;
        this.playChunk(index + 1, myId);
      };

      audio.ontimeupdate = () => {
        if (myId !== this.playbackId || !this.isSpeaking) return;
        const posMs = Math.floor((audio.currentTime || 0) * 1000);
        const durMs = !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0
          ? Math.floor(audio.duration * 1000)
          : 0;
        if (durMs > 0) this.chunkDurationsMs[index] = durMs;
        this.notifyProgress(this.cumulativeMs(index, posMs), this.totalEstimatedMs(), !audio.paused);
      };

      audio.playbackRate = this.currentSpeed;
      await audio.play();

      // Nạp trước câu tiếp theo vào slot đối diện (Slot B / Slot A)
      const nextIdx = index + 1;
      if (nextIdx < this.sentences.length) {
        const nextUrl = this.chunkUrl(nextIdx);
        const preAudio = new Audio(nextUrl);
        preAudio.preload = 'auto';
        if (nextSlot === 'A') this.webAudioSlotA = preAudio;
        else this.webAudioSlotB = preAudio;
      }
    } catch (err) {
      console.log('[TTS Web Ping-Pong] error:', err);
      this.playChunk(index + 1, myId);
    }
  }

  private async playChunkNativePingPong(index: number, myId: number) {
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
      this.playChunk(index + 1, myId);
      return;
    }
    this.consecutiveFailures = 0;

    // Buffer trước câu N+2
    this.prefetchAhead(index, myId);

    try {
      if (setAudioModeAsync) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      }

      const currentSlot = this.activeSlot;
      const nextSlot = currentSlot === 'A' ? 'B' : 'A';

      // Lấy player đã được preloaded hoặc tạo mới
      let player = currentSlot === 'A' ? this.playerSlotA : this.playerSlotB;
      if (!player) {
        player = createAudioPlayer(uri, { updateInterval: 250 });
        if (currentSlot === 'A') this.playerSlotA = player;
        else this.playerSlotB = player;
      }
      this.activePlayer = player;
      this.isUsingServerAudio = true;

      player.addListener('playbackStatusUpdate', (status: any) => {
        if (myId !== this.playbackId || !this.isSpeaking) return;
        const posMs = (status.currentTime || 0) * 1000;
        const durMs = (status.duration || 0) * 1000;
        if (durMs > 0) this.chunkDurationsMs[index] = durMs;
        this.notifyProgress(this.cumulativeMs(index, posMs), this.totalEstimatedMs(), status.playing);

        if (status.didJustFinish) {
          // Khi slot hiện tại kết thúc -> đổi activeSlot sang slot đối diện ngay tức thì
          this.activeSlot = nextSlot;
          const preloadedNext = nextSlot === 'A' ? this.playerSlotA : this.playerSlotB;
          if (preloadedNext) {
            // Gapless 0ms: Kích hoạt play ngay lập tức!
            try {
              preloadedNext.play();
            } catch {}
          }
          // Dọn slot cũ
          try {
            player.remove();
          } catch {}
          if (currentSlot === 'A') this.playerSlotA = null;
          else this.playerSlotB = null;

          this.playChunk(index + 1, myId);
        }
      });

      player.play();

      // Nạp trước câu N+1 vào nextSlot (Slot B hoặc A)
      const nextIdx = index + 1;
      if (nextIdx < this.sentences.length) {
        this.fetchChunk(nextIdx, myId).then(nextUri => {
          if (myId !== this.playbackId || !nextUri) return;
          try {
            const prePlayer = createAudioPlayer(nextUri, { updateInterval: 250 });
            if (nextSlot === 'A') this.playerSlotA = prePlayer;
            else this.playerSlotB = prePlayer;
          } catch {}
        }).catch(() => {});
      }
    } catch (err) {
      console.log('[TTS Ping-Pong Native] playChunk error:', err);
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
    if (Platform.OS === 'web') {
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
    }

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
    this.duckBgm(false);

    if (this.webAudio) {
      try {
        this.webAudio.pause();
      } catch {}
      const posMs = Math.floor((this.webAudio.currentTime || 0) * 1000);
      const rawDur = (!isNaN(this.webAudio.duration) && isFinite(this.webAudio.duration) && this.webAudio.duration > 0)
        ? Math.floor(this.webAudio.duration * 1000)
        : 10000;
      this.notifyProgress(posMs, rawDur, false);
      return;
    } else if (this.isUsingServerAudio && this.activePlayer) {
      try {
        this.activePlayer.pause();
      } catch {}
      if (!this.chapterMode) {
        this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, false);
      }
      return;
    } else {
      try {
        await Speech.pause();
      } catch {}
    }
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, false);
  }

  public async resume() {
    this.isPaused = false;
    this.duckBgm(true);

    if (this.webAudio) {
      try {
        await this.webAudio.play();
      } catch {}
      const posMs = Math.floor((this.webAudio.currentTime || 0) * 1000);
      const rawDur = (!isNaN(this.webAudio.duration) && isFinite(this.webAudio.duration) && this.webAudio.duration > 0)
        ? Math.floor(this.webAudio.duration * 1000)
        : 10000;
      this.notifyProgress(posMs, rawDur, true);
      return;
    } else if (this.isUsingServerAudio && this.activePlayer) {
      try {
        this.activePlayer.play();
      } catch {}
      if (!this.chapterMode) {
        this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, true);
      }
      return;
    } else {
      try {
        await Speech.resume();
      } catch {}
    }
    this.notifyProgress(this.elapsedMs, this.estimatedDurationMs, true);
  }

  public async stop() {
    this.playbackId += 1; // vô hiệu hóa mọi chunk đang tải/phát dở
    this.chunkUris = [];
    this.chunkPrefetching = [];
    this.chapterMode = false;
    this.chapterDurationMs = 0;
    this.chapterOnMsProgress = null;
    this.duckBgm(false);

    if (this.currentSessionId) {
      this.abortCurrentStream(this.currentSessionId).catch(() => {});
      this.currentSessionId = null;
    }
    this.isLiveStreamingMode = false;

    this.cleanUp();

    // Dọn dẹp Web players
    if (this.webAudio) {
      try {
        this.webAudio.pause();
        this.webAudio.src = '';
      } catch {}
      this.webAudio = null;
    }
    if (this.webAudioSlotA) {
      try {
        this.webAudioSlotA.pause();
        this.webAudioSlotA.src = '';
      } catch {}
      this.webAudioSlotA = null;
    }
    if (this.webAudioSlotB) {
      try {
        this.webAudioSlotB.pause();
        this.webAudioSlotB.src = '';
      } catch {}
      this.webAudioSlotB = null;
    }
    if (this.webBlobUrl) {
      try {
        URL.revokeObjectURL(this.webBlobUrl);
      } catch {}
      this.webBlobUrl = null;
    }

    // Dọn dẹp Native players (A & B)
    if (this.activePlayer) {
      try {
        this.activePlayer.pause();
        this.activePlayer.remove();
      } catch {}
      this.activePlayer = null;
    }
    if (this.playerSlotA) {
      try {
        this.playerSlotA.pause();
        this.playerSlotA.remove();
      } catch {}
      this.playerSlotA = null;
    }
    if (this.playerSlotB) {
      try {
        this.playerSlotB.pause();
        this.playerSlotB.remove();
      } catch {}
      this.playerSlotB = null;
    }

    this.isUsingServerAudio = false;
    try {
      await Speech.stop();
    } catch {}
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
    if (this.webAudio) {
      return Boolean(this.webAudio.paused && !this.webAudio.ended);
    }
    return this.isPaused;
  }

  public setNowPlaying(title: string, subtitle?: string) {
    // Can be used for lock screen / notification media controls
  }

  /**
   * BƯỚC 3: Tua trực tiếp đến câu bất kỳ (Tap-to-Seek Read-Along)
   */
  public async seekToSentence(index: number) {
    if (index < 0 || index >= this.sentences.length) return;
    const myId = ++this.playbackId;
    this.sentenceIndex = index;

    // Dọn các slot đang chạy
    if (this.activePlayer) {
      try {
        this.activePlayer.pause();
        this.activePlayer.remove();
      } catch {}
      this.activePlayer = null;
    }
    if (this.playerSlotA) {
      try {
        this.playerSlotA.pause();
        this.playerSlotA.remove();
      } catch {}
      this.playerSlotA = null;
    }
    if (this.playerSlotB) {
      try {
        this.playerSlotB.pause();
        this.playerSlotB.remove();
      } catch {}
      this.playerSlotB = null;
    }
    if (this.webAudio) {
      try {
        this.webAudio.pause();
      } catch {}
    }

    this.activeSlot = 'A';
    this.playChunk(index, myId);
  }

  public async seekTo(ms: number) {
    // Chapter-audio mode: tua trực tiếp trên file MP3 nguyên chương
    if (this.chapterMode) {
      if (this.webAudio) {
        try {
          this.webAudio.currentTime = Math.max(0, ms) / 1000;
          const posMs = Math.floor((this.webAudio.currentTime || 0) * 1000);
          const rawDur = (!isNaN(this.webAudio.duration) && isFinite(this.webAudio.duration) && this.webAudio.duration > 0)
            ? Math.floor(this.webAudio.duration * 1000)
            : (this.chapterDurationMs || Math.max(posMs + 1000, 60000));
          this.chapterDurationMs = rawDur;
          this.notifyProgress(posMs, Math.max(rawDur, posMs), !this.webAudio.paused);
        } catch (e) {
          console.log('[TTS] seekTo (web chapter) error:', e);
        }
        return;
      }
      if (this.isUsingServerAudio && this.activePlayer) {
        try {
          await this.activePlayer.seekTo(Math.max(0, ms) / 1000);
        } catch (e) {
          console.log('[TTS] seekTo (chapter) error:', e);
        }
        return;
      }
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
        await this.seekToSentence(targetIndex);
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

  /**
   * BƯỚC 3: Khởi tạo phiên Live Stream Kokoro trực tiếp (/api/stream/start)
   * Nhận manifest danh sách câu và phát ngay câu đầu tiên với latency < 1.6s!
   */
  public async streamChapter(params: {
    bookId: string;
    chapterId: string;
    text: string;
    url?: string;
    voice?: string;
    speed?: number;
    startSentenceIndex?: number;
    onFinish?: () => void;
    onError?: (err: any) => void;
    onSentence?: SentenceListener;
    onSentencesLoaded?: SentencesLoadedListener;
  }): Promise<boolean> {
    await this.stop();

    if (!params.text || params.text.trim().length === 0) return false;

    this.playbackId += 1;
    const myId = this.playbackId;
    this.isSpeaking = true;
    this.isPaused = false;
    this.speakOnFinish = params.onFinish || null;
    this.speakOnError = params.onError || null;
    this.onSentenceChange = params.onSentence || null;
    this.consecutiveFailures = 0;

    const startIdx = Math.max(0, params.startSentenceIndex || 0);
    const voiceId = params.voice || this.currentVoice.id || 'duc_an';
    const speed = params.speed || this.currentSpeed || 1.0;

    const base = this.getBaseUrl();
    console.log(`[TTS Stream] Khởi tạo phiên Live Stream tại ${base}/api/stream/start...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const res = await fetch(`${base}/api/stream/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: params.bookId,
          chapter_id: params.chapterId,
          text: params.text,
          url: params.url || '',
          voice: voiceId,
          speed: speed,
          start_chunk_index: startIdx,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        console.log(`[TTS Stream] Phiên tạo thành công! Session: ${data.session_id}, ${data.total_chunks} chunks.`);
        this.currentSessionId = data.session_id;
        this.isLiveStreamingMode = true;

        if (Array.isArray(data.sentences) && data.sentences.length > 0) {
          this.sentences = data.sentences;
        } else {
          this.sentences = this.splitSentences(params.text);
        }

        if (params.onSentencesLoaded) params.onSentencesLoaded(this.sentences);
        this.notifySentencesLoaded(this.sentences);

        this.sentenceIndex = startIdx;
        this.chunkUris = new Array(this.sentences.length).fill(null);
        this.chunkDurationsMs = new Array(this.sentences.length).fill(null);
        this.chunkPrefetching = new Array(this.sentences.length).fill(null);

        this.activeSlot = 'A';
        this.playChunk(startIdx, myId);
        return true;
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[TTS Stream] Server trả về mã lỗi HTTP ${res.status}: ${errText}`);
      }
    } catch (streamErr: any) {
      console.warn('[TTS Stream] /api/stream/start lỗi kết nối:', streamErr?.message || streamErr);
    }

    // Fallback: Chạy chế độ speak câu đơn thông thường nếu server streaming chưa bật
    this.isLiveStreamingMode = false;
    this.speak(
      params.text,
      params.onFinish,
      params.onError,
      params.onSentence,
      startIdx
    );
    return false;
  }

  /**
   * BƯỚC 3: Hủy phiên stream khi người dùng thoát hoặc chuyển chương
   */
  public async abortCurrentStream(sessionId?: string): Promise<void> {
    const sid = sessionId || this.currentSessionId;
    if (!sid) return;
    try {
      const base = this.serverBaseUrl || `http://${this.serverIp}:${this.serverPort}`;
      await fetch(`${base}/api/stream/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      console.log(`[TTS Stream] Đã gửi abort cho session ${sid}`);
    } catch {}
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const ttsService = new TTSService();
