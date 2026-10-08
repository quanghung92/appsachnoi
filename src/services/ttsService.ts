/**
 * ttsService.ts — Engine đọc sách nói.
 *
 * Engine chính: Edge-TTS trực tiếp từ máy (WebSocket tới Microsoft),
 * giọng Neural Hoài My / Nam Minh, KHÔNG cần server trung gian, KHÔNG cần PC.
 *  - Text được chia chunk theo câu (~700 ký tự/chunk)
 *  - Mỗi chunk tổng hợp thành MP3, cache trên máy theo hash (text + voice)
 *  - Phát nối tiếp bằng expo-audio, prefetch chunk kế tiếp để không bị ngắt
 *  - Seek / tua / tiến trình / pause-resume đều là THẬT (theo audio)
 *
 * Engine dự phòng: giọng hệ thống của máy (expo-speech) khi không có mạng
 * hoặc Microsoft chặn kết nối.
 */
import * as Speech from 'expo-speech';
import {
  createAudioPlayer,
  setAudioModeAsync,
  AudioPlayer,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { VoiceOption } from '../types';
import { synthesizeChunk } from './edgeTtsClient';

export const VIETNAMESE_VOICES: VoiceOption[] = [
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng đọc truyền cảm, ấm áp (Khuyên dùng cho truyện & tản văn)',
    sampleText: 'Chào bạn, tôi là Hoài My, giọng đọc AI của AudioVerse.',
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng phát thanh viên trầm ấm, đĩnh đạc (Phù hợp sách kinh doanh & kỹ năng)',
    sampleText: 'Chào bạn, tôi là Nam Minh, chúc bạn có những phút giây nghe sách thú vị.',
  },
];

type ProgressListener = (progress: {
  isSpeaking: boolean;
  positionMs: number;
  durationMs: number;
}) => void;

const CHUNK_CHARS = 700;
// Tốc độ đọc ước lượng của Edge-TTS tiếng Việt (ký tự/giây) — chỉ dùng để
// ước lượng tổng thời lượng các chunk chưa tải xong.
const CHARS_PER_SEC = 14;

function splitIntoChunks(text: string, maxLen: number = CHUNK_CHARS): string[] {
  const sentences =
    text.match(/[^.!?…\n]+[.!?…\n]+|[^.!?…\n]+$/g) || [text];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    const merged = cur ? `${cur} ${t}` : t;
    if (merged.length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = t;
    } else {
      cur = merged;
    }
    while (cur.length > maxLen * 1.5) {
      chunks.push(cur.slice(0, maxLen).trim());
      cur = cur.slice(maxLen).trim();
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 0);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + STEP))
    );
  }
  return btoa(binary);
}

async function sha256Hex(s: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

class TTSService {
  private currentVoice: VoiceOption = VIETNAMESE_VOICES[0];
  private currentSpeed: number = 1.0;
  private isSpeaking: boolean = false;
  private userPaused: boolean = false;
  private engine: 'edge' | 'system' = 'edge';
  private progressListeners: ProgressListener[] = [];

  // Trạng thái phát Edge-TTS
  private player: AudioPlayer | null = null;
  private chunks: string[] = [];
  private chunkUris: (string | null)[] = [];
  private chunkDurationsSec: number[] = [];
  private chunkIndex: number = 0;
  private pendingSeekSec: number = 0;
  private stopRequested: boolean = false;
  private playGen: number = 0;
  private prefetching = new Set<number>();
  private nowPlayingTitle: string = '';
  private nowPlayingArtist: string = '';

  // Trạng thái fallback expo-speech
  private sysEstimatedMs: number = 0;
  private sysElapsedMs: number = 0;
  private sysTimer: ReturnType<typeof setInterval> | null = null;

  // ---------- API công khai ----------

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
    if (this.engine === 'edge' && this.player) {
      try {
        this.player.playbackRate = speed;
      } catch {
        /* noop */
      }
    }
  }

  public getSpeed(): number {
    return this.currentSpeed;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public isPausedState(): boolean {
    return this.userPaused && this.isSpeaking;
  }

  /** Thông tin hiển thị trên màn hình khóa / Control Center. */
  public setNowPlaying(title: string, artist: string) {
    this.nowPlayingTitle = title;
    this.nowPlayingArtist = artist;
    if (this.player) {
      try {
        this.player.setActiveForLockScreen(true, { title, artist });
      } catch {
        /* noop */
      }
    }
  }

  public addProgressListener(listener: ProgressListener) {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter(
        (l) => l !== listener
      );
    };
  }

  private notifyProgress(posMs: number, durMs: number, speaking: boolean) {
    this.progressListeners.forEach((listener) => {
      listener({ isSpeaking: speaking, positionMs: posMs, durationMs: durMs });
    });
  }

  /** Bắt đầu đọc 1 đoạn text (tự chia chunk, tự nối chương qua onFinish). */
  public async speak(
    text: string,
    onFinish?: () => void,
    onError?: (error: unknown) => void
  ) {
    this.stopInternal();
    const gen = this.playGen;

    if (!text || text.trim().length === 0) {
      if (onFinish) onFinish();
      return;
    }

    this.chunks = splitIntoChunks(text);
    this.chunkUris = this.chunks.map(() => null);
    this.chunkDurationsSec = this.chunks.map(() => 0);
    this.chunkIndex = 0;
    this.pendingSeekSec = 0;
    this.isSpeaking = true;
    this.userPaused = false;
    this.stopRequested = false;
    this.engine = 'edge';

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
    } catch {
      /* noop */
    }

    // Thử tổng hợp chunk đầu bằng Edge-TTS. Hỏng -> rớt về giọng hệ thống.
    try {
      await this.ensureChunkAudio(0, gen);
    } catch (e) {
      console.log('[TTS] Edge-TTS không dùng được, dùng giọng hệ thống:', e);
      this.engine = 'system';
      this.speakWithSystem(text, onFinish, onError, gen);
      return;
    }

    this.playbackLoop(gen, onFinish, onError);
  }

  public async pause() {
    if (this.engine === 'system') {
      this.userPaused = true;
      try {
        await Speech.pause();
      } catch {
        /* noop */
      }
      this.notifyProgress(this.sysElapsedMs, this.sysEstimatedMs, false);
      return;
    }
    this.userPaused = true;
    try {
      this.player?.pause();
    } catch {
      /* noop */
    }
    this.reportProgress();
  }

  public async resume() {
    if (this.engine === 'system') {
      this.userPaused = false;
      try {
        await Speech.resume();
      } catch {
        /* noop */
      }
      this.notifyProgress(this.sysElapsedMs, this.sysEstimatedMs, true);
      return;
    }
    this.userPaused = false;
    try {
      this.player?.play();
    } catch {
      /* noop */
    }
    this.reportProgress();
  }

  public async stop() {
    this.stopInternal();
    this.notifyProgress(0, 1000, false);
  }

  /** Tua tới vị trí ms (tính trên toàn bộ text). Chỉ có tác dụng với engine Edge. */
  public async seekTo(ms: number) {
    if (this.engine !== 'edge' || this.chunks.length === 0) return;
    const totalMs = this.estimatedTotalMs();
    const clamped = Math.max(0, Math.min(ms, totalMs));

    let acc = 0;
    let target = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const dMs = this.chunkMs(i);
      if (clamped < acc + dMs || i === this.chunks.length - 1) {
        target = i;
        break;
      }
      acc += dMs;
    }
    this.pendingSeekSec = Math.max(0, (clamped - acc) / 1000);
    this.chunkIndex = target;
    this.userPaused = false;

    // Dừng audio chunk hiện tại rồi phát lại từ chunk đích
    try {
      this.player?.release();
    } catch {
      /* noop */
    }
    this.player = null;

    // Hủy vòng phát hiện tại, phát lại từ chunk đích
    const gen = ++this.playGen;
    this.stopRequested = false;
    this.playbackLoop(gen);
  }

  // ---------- Nội bộ: Edge-TTS ----------

  private cacheDir(): string {
    return `${FileSystem.cacheDirectory}edge_tts/`;
  }

  private async ensureChunkAudio(i: number, gen: number): Promise<string> {
    const hit = this.chunkUris[i];
    if (hit) return hit;

    const key = await sha256Hex(`${this.currentVoice.id}::${this.chunks[i]}`);
    const uri = `${this.cacheDir()}${key}.mp3`;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      this.chunkUris[i] = uri;
      return uri;
    }

    const bytes = await synthesizeChunk(this.chunks[i], this.currentVoice.id);
    if (gen !== this.playGen) {
      throw new Error('stale generation');
    }
    try {
      await FileSystem.makeDirectoryAsync(this.cacheDir(), {
        intermediates: true,
      });
    } catch {
      /* đã tồn tại */
    }
    await FileSystem.writeAsStringAsync(uri, uint8ToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    this.chunkUris[i] = uri;
    return uri;
  }

  private prefetch(i: number, gen: number) {
    if (i < 0 || i >= this.chunks.length || this.prefetching.has(i)) return;
    this.prefetching.add(i);
    this.ensureChunkAudio(i, gen)
      .catch(() => {
        /* prefetch hỏng thì chunk đó sẽ thử lại khi tới lượt */
      })
      .finally(() => {
        this.prefetching.delete(i);
      });
  }

  private chunkMs(i: number): number {
    const known = this.chunkDurationsSec[i];
    if (known > 0) return known * 1000;
    return (this.chunks[i].length / CHARS_PER_SEC) * 1000;
  }

  private estimatedTotalMs(): number {
    let ms = 0;
    for (let i = 0; i < this.chunks.length; i++) ms += this.chunkMs(i);
    return ms;
  }

  private globalPositionMs(): number {
    let ms = 0;
    for (let i = 0; i < this.chunkIndex; i++) ms += this.chunkMs(i);
    if (this.player) {
      try {
        ms += (this.player.currentTime || 0) * 1000;
      } catch {
        /* noop */
      }
    }
    return ms;
  }

  private reportProgress() {
    this.notifyProgress(
      this.globalPositionMs(),
      this.estimatedTotalMs(),
      this.isSpeaking && !this.userPaused
    );
  }

  private async playbackLoop(
    gen: number,
    onFinish?: () => void,
    onError?: (error: unknown) => void
  ) {
    while (
      gen === this.playGen &&
      this.chunkIndex < this.chunks.length &&
      !this.stopRequested
    ) {
      const i = this.chunkIndex;
      try {
        const uri = await this.ensureChunkAudio(i, gen);
        if (gen !== this.playGen || this.stopRequested) return;
        this.prefetch(i + 1, gen);
        const seekSec = this.pendingSeekSec;
        this.pendingSeekSec = 0;
        await this.playUri(uri, seekSec, gen);
        if (gen !== this.playGen || this.stopRequested) return;
        this.chunkIndex++;
      } catch (e) {
        console.log('[TTS] Lỗi phát chunk', i, e);
        this.stopInternal();
        if (onError) onError(e);
        return;
      }
    }

    if (gen === this.playGen && !this.stopRequested) {
      const total = this.estimatedTotalMs();
      this.stopInternal();
      this.notifyProgress(total, total, false);
      if (onFinish) onFinish();
    }
  }

  private playUri(uri: string, seekSec: number, gen: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.player?.release();
      } catch {
        /* noop */
      }
      const player = createAudioPlayer({ uri });
      this.player = player;
      try {
        player.shouldCorrectPitch = true;
        player.playbackRate = this.currentSpeed;
      } catch {
        /* noop */
      }
      if (this.nowPlayingTitle) {
        try {
          player.setActiveForLockScreen(true, {
            title: this.nowPlayingTitle,
            artist: this.nowPlayingArtist || 'AudioVerse',
          });
        } catch {
          /* noop */
        }
      }

      let settled = false;
      let started = false;
      let playStart = 0;
      const startWait = Date.now();
      const finishOk = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const finishErr = (e: unknown) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };

      const tick = () => {
        if (settled) return;
        if (gen !== this.playGen || this.stopRequested) {
          finishOk();
          return;
        }
        if (this.userPaused) {
          this.reportProgress();
          setTimeout(tick, 300);
          return;
        }
        try {
          if (!player.isLoaded) {
            if (Date.now() - startWait > 20000) {
              finishErr(new Error('Tải audio quá lâu'));
              return;
            }
            setTimeout(tick, 200);
            return;
          }
          if (!started) {
            started = true;
            const dur = player.duration || 0;
            if (dur > 0) this.chunkDurationsSec[this.chunkIndex] = dur;
            if (seekSec > 0 && dur > seekSec) {
              player.seekTo(seekSec);
            }
            player.play();
            playStart = Date.now();
          }
          this.reportProgress();
          // Phát xong khi player dừng và đã qua thời gian ân hạn
          if (started && !player.playing && Date.now() - playStart > 800) {
            finishOk();
            return;
          }
          setTimeout(tick, 300);
        } catch (e) {
          finishErr(e);
        }
      };
      tick();
    });
  }

  private stopInternal() {
    this.stopRequested = true;
    this.playGen++;
    this.isSpeaking = false;
    this.userPaused = false;
    this.prefetching.clear();
    try {
      this.player?.release();
    } catch {
      /* noop */
    }
    this.player = null;
    if (this.sysTimer) {
      clearInterval(this.sysTimer);
      this.sysTimer = null;
    }
    try {
      Speech.stop();
    } catch {
      /* noop */
    }
  }

  // ---------- Engine dự phòng: giọng hệ thống ----------

  private speakWithSystem(
    text: string,
    onFinish?: () => void,
    onError?: (error: unknown) => void,
    gen?: number
  ) {
    const myGen = gen ?? this.playGen;
    this.isSpeaking = true;
    this.userPaused = false;

    const wordCount = text.split(/\s+/).length;
    const wordsPerSec = (150 / 60) * this.currentSpeed;
    this.sysEstimatedMs = Math.max(wordCount / wordsPerSec, 4) * 1000;
    this.sysElapsedMs = 0;

    this.sysTimer = setInterval(() => {
      if (myGen !== this.playGen) return;
      if (this.isSpeaking && !this.userPaused) {
        this.sysElapsedMs += 250;
        if (this.sysElapsedMs > this.sysEstimatedMs) {
          this.sysElapsedMs = this.sysEstimatedMs;
        }
        this.notifyProgress(this.sysElapsedMs, this.sysEstimatedMs, true);
      }
    }, 250);

    try {
      Speech.speak(text, {
        language: 'vi-VN',
        pitch: 1.0,
        rate: Math.min(Math.max(this.currentSpeed, 0.4), 1.8),
        onDone: () => {
          if (myGen !== this.playGen) return;
          this.stopInternal();
          this.notifyProgress(this.sysEstimatedMs, this.sysEstimatedMs, false);
          if (onFinish) onFinish();
        },
        onStopped: () => {
          if (myGen !== this.playGen) return;
          this.stopInternal();
        },
        onError: (err) => {
          if (myGen !== this.playGen) return;
          this.stopInternal();
          if (onError) onError(err);
        },
      });
    } catch (err) {
      this.stopInternal();
      if (onError) onError(err);
    }
  }
}

export const ttsService = new TTSService();
