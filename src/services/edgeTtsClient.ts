/**
 * edgeTtsClient.ts
 *
 * Gọi trực tiếp Microsoft Edge TTS từ app (không cần server trung gian).
 * Giao thức WebSocket được port từ thư viện edge_tts (Python):
 *   wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
 *
 * Mỗi lần gọi: mở 1 WebSocket -> gửi speech.config -> gửi SSML ->
 * nhận các chunk audio MP3 (Path:audio) -> đóng khi gặp Path:turn.end.
 */
import * as Crypto from 'expo-crypto';
import { EDGE_TRUSTED_CLIENT_TOKEN } from './edgeTtsConfig';

const WSS_BASE =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
// Windows file time epoch: số giây từ 1601-01-01 đến 1970-01-01
const WIN_EPOCH = 11644473600;

function uuidHex(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** Chuỗi ngày kiểu Javascript, theo chuẩn của edge_tts (UTC). */
function dateToString(): string {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ` +
    `${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(
      d.getUTCSeconds()
    )} GMT+0000 (Coordinated Universal Time)`
  );
}

/**
 * Tạo token Sec-MS-GEC theo đúng thuật toán của edge_tts/drm.py:
 * SHA256(uppercase hex) của (windows_file_time_lam_tron_5_phut + trusted_client_token)
 */
async function generateSecMsGec(): Promise<string> {
  const unixSec = Math.floor(Date.now() / 1000);
  const ticks = unixSec + WIN_EPOCH;
  const rounded = ticks - (ticks % 300);
  // Dùng BigInt: rounded * 10^7 vượt quá độ chính xác của float64
  const filetime = BigInt(rounded) * 10_000_000n;
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${filetime.toString()}${EDGE_TRUSTED_CLIENT_TOKEN}`,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return digest.toUpperCase();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildSsml(text: string, voice: string): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

/**
 * Tổng hợp 1 đoạn text thành MP3 (Uint8Array).
 * Ném lỗi nếu: không nối được WebSocket, timeout, hoặc server không trả audio.
 */
export async function synthesizeChunk(
  text: string,
  voice: string,
  timeoutMs: number = 45000
): Promise<Uint8Array> {
  const clean = text.trim();
  if (!clean) {
    throw new Error('Empty text');
  }

  const connectionId = uuidHex();
  const secMsGec = await generateSecMsGec();
  const url =
    `${WSS_BASE}?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return new Promise<Uint8Array>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Cannot create WebSocket'));
      return;
    }
    // Nhận binary dưới dạng ArrayBuffer để bóc MP3
    (ws as unknown as { binaryType: string }).binaryType = 'arraybuffer';

    const audioParts: Uint8Array[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error('Edge-TTS timeout')));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const closeQuietly = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };

    ws.onopen = () => {
      const ts = dateToString();
      // 1. Gói tin cấu hình
      ws.send(
        `X-Timestamp:${ts}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":` +
          `{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},` +
          `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
      );
      // 2. Gói tin SSML chứa text cần đọc
      const requestId = uuidHex();
      ws.send(
        `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${ts}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          buildSsml(clean, voice)
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          finish(() => {
            closeQuietly();
            if (audioParts.length === 0) {
              reject(new Error('Edge-TTS: server không trả về audio'));
              return;
            }
            let total = 0;
            for (const p of audioParts) total += p.length;
            const out = new Uint8Array(total);
            let offset = 0;
            for (const p of audioParts) {
              out.set(p, offset);
              offset += p.length;
            }
            resolve(out);
          });
        }
        // Bỏ qua turn.start và các message text khác
        return;
      }
      // Message nhị phân: [2 byte độ dài header][header text][\r\n][mp3 bytes]
      try {
        const buf =
          data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
        if (buf.length < 2) return;
        const headerLen = (buf[0] << 8) | buf[1];
        if (2 + headerLen + 2 > buf.length) return;
        let header = '';
        for (let i = 2; i < 2 + headerLen; i++) {
          header += String.fromCharCode(buf[i]);
        }
        if (header.includes('Path:audio')) {
          audioParts.push(buf.slice(2 + headerLen + 2));
        }
      } catch {
        /* bỏ qua gói tin lỗi */
      }
    };

    ws.onerror = () => {
      finish(() => reject(new Error('Edge-TTS: lỗi kết nối WebSocket')));
    };

    ws.onclose = () => {
      finish(() => reject(new Error('Edge-TTS: kết nối đóng giữa chừng')));
    };
  });
}
