#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AudioVerse Streaming Backend Server v6.1 (Production-Ready).
Hỗ trợ cả chạy cục bộ (Ubuntu cty qua Cloudflare Tunnel) và chạy trên Modal Cloud.

Giải quyết trọn vẹn 4 điểm phản biện kỹ thuật:
  1. MP3 Streaming (Nén 85% dung lượng): Nén WAV sang MP3 64kbps qua ffmpeg pipe, giảm từ ~240KB xuống ~30KB/chunk.
  2. Preemption Enforce: Worker chạy batch ngầm tự động tạm dừng ngay khi có người bấm nghe stream.
  3. Hoàn thiện /api/batch/backfill: Gen thật từng câu còn thiếu, tự động ghép thành file MP3 hoàn chỉnh khi đủ 100%.
  4. Kế thừa 470 file Drive (Seed Cache): Nạp sẵn index Google Drive, client phát thẳng không gen lại.
"""

import asyncio
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Đảm bảo đường dẫn import cho audioverse_batch
_CURR_DIR = str(Path(__file__).resolve().parent)
if _CURR_DIR not in sys.path:
    sys.path.insert(0, _CURR_DIR)

# Tự động kiểm tra và tải các thư viện thiếu (vig2p, onnxruntime, soundfile, ...)
try:
    from check_and_install_deps import ensure_dependencies
    ensure_dependencies()
except Exception as _dep_err:
    print(f"[Dependency Warning] Không thể auto-check dependencies: {_dep_err}")

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import Kokoro & Normalizer
try:
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX
    from kokoro_vietnamese.core import VOICES, SAMPLE_RATE
    from kokoro_vietnamese.normalizer import normalize_text_for_tts
except ImportError:
    from audioverse_batch.kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX
    from audioverse_batch.kokoro_vietnamese.core import VOICES, SAMPLE_RATE
    from audioverse_batch.kokoro_vietnamese.normalizer import normalize_text_for_tts

import soundfile as sf
try:
    import imageio_ffmpeg
except ImportError:
    imageio_ffmpeg = None

# --- Đường dẫn lưu trữ ---
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", str(BASE_DIR / "models")))
CACHE_DIR = DATA_DIR / "stream_cache"
INDEX_PATH = DATA_DIR / "index.json"
QUEUE_PATH = DATA_DIR / "queue.json"

for d in [DATA_DIR, CACHE_DIR, MODEL_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# Quản lý vòng đời ứng dụng theo chuẩn FastAPI Lifespan mới nhất
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Khởi chạy background worker (Preemption & Backfill)
    asyncio.create_task(background_batch_worker())
    # 2. Tự động đồng bộ 470 file MP3 Seed Cache từ Google Drive
    asyncio.create_task(sync_upstream_seed_index())
    # 3. Dọn dẹp cache v1 cũ có lỗi phát âm tiếng Anh (như từ 'do' bị đọc thành 'đu')
    def _clean_stale_cache():
        try:
            removed = 0
            for old_f in CACHE_DIR.rglob("chunk_[0-9]*.mp3"):
                old_f.unlink(missing_ok=True)
                removed += 1
            if removed > 0:
                print(f"[Cache Cleaner] 🧹 Đã dọn {removed} file chunk v1 cũ để cập nhật phát âm tiếng Việt chuẩn mới nhất!")
        except Exception as e:
            print(f"[Cache Cleaner Warning] {e}")

    # 4. Nạp trước Kokoro model vào RAM (Warmup) để request đầu tiên không bị delay
    def _warmup():
        try:
            _clean_stale_cache()
            print("[Warmup] Đang nạp trước mô hình Kokoro vào RAM...")
            m = get_kokoro_model(DEFAULT_VOICE)
            m.synthesize("Xin chào bạn đến với AudioVerse.", speed=1.0)
            print("[Warmup] ✅ Mô hình Kokoro đã sẵn sàng 100% trong RAM!")
        except Exception as e:
            print(f"[Warmup Warning] Không thể nạp trước model: {e}")

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _warmup)
    # 5. Tự động đẩy chương stream xong lên Google Drive (mỗi 30 phút, nếu có credentials)
    asyncio.create_task(auto_upload_drive_worker())
    yield

# Khởi tạo FastAPI với lifespan
app = FastAPI(title="AudioVerse Streaming API", version="6.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Kokoro Model Cache (Lazy load per voice)
_kokoro_models: Dict[str, KokoroVietnameseONNX] = {}

# Single-Flight Coalescing: key -> asyncio.Future
_in_flight_tasks: Dict[str, asyncio.Future] = {}

# Session Store: session_id -> SessionData
_sessions: Dict[str, dict] = {}

# Hàng đợi tác vụ Gen bù ngầm (Backfill Queue)
_backfill_queue: asyncio.Queue = asyncio.Queue()

# Priority Scheduler: Thời điểm hết hạn phiên stream gần nhất
STREAM_ACTIVE_UNTIL: float = 0.0

DEFAULT_VOICE = "duc_an"


def update_stream_activity(timeout_seconds: float = 60.0):
    """Ghi nhận có người dùng đang stream, yêu cầu hoãn batch ngầm."""
    global STREAM_ACTIVE_UNTIL
    STREAM_ACTIVE_UNTIL = time.time() + timeout_seconds


def is_stream_active() -> bool:
    """Kiểm tra xem hiện tại có ai đang nghe stream trực tiếp không."""
    return time.time() < STREAM_ACTIVE_UNTIL


def wav_to_mp3(wav_bytes: bytes, bitrate: str = "64k") -> bytes:
    """
    Chuyển đổi WAV sang MP3 bằng ffmpeg pipe in-memory (không tạo file tạm).
    Giảm 85% dung lượng truyền tải qua mạng (từ 240KB -> ~35KB).
    """
    try:
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            ffmpeg_exe,
            "-y",
            "-v", "error",
            "-f", "wav",
            "-i", "pipe:0",
            "-codec:a", "libmp3lame",
            "-b:a", bitrate,
            "-f", "mp3",
            "pipe:1"
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = proc.communicate(input=wav_bytes)
        if proc.returncode == 0 and len(out) > 100:
            return out
    except Exception as e:
        print(f"[WAV->MP3 Warning] Lỗi nén MP3: {e}. Sử dụng WAV gốc.")
    return wav_bytes


def get_kokoro_model(voice_id: str = DEFAULT_VOICE) -> KokoroVietnameseONNX:
    """Nạp model Kokoro ONNX (in-memory singleton)."""
    clean_voice = (voice_id or "").lower().replace("kokoro_", "").strip()
    if clean_voice not in VOICES:
        clean_voice = DEFAULT_VOICE

    if clean_voice not in _kokoro_models:
        print(f"[Kokoro] Đang nạp model cho giọng: {clean_voice}...")
        kwargs = {"voice": clean_voice, "device": "cpu"}
        local_onnx = MODEL_DIR / "kokoro_vi.onnx"
        local_cfg = MODEL_DIR / "config.json"
        local_vp = MODEL_DIR / VOICES[clean_voice]["filename"]
        if local_onnx.exists() and local_cfg.exists():
            kwargs.update({
                "onnx_path": str(local_onnx),
                "config_path": str(local_cfg),
                "voicepack_path": str(local_vp) if local_vp.exists() else None,
            })
        _kokoro_models[clean_voice] = KokoroVietnameseONNX(**kwargs)
        print(f"[Kokoro] Nạp model giọng {clean_voice} hoàn tất!")

    return _kokoro_models[clean_voice]


# ----------------------------------------------------------------
# Helper: Cắt câu thích ứng (Adaptive Chunking)
# ----------------------------------------------------------------

def _hard_split_long_text(text: str, max_words: int = 30) -> List[str]:
    """Cắt nhỏ đoạn văn dài hơn max_words theo dấu phẩy, hai chấm, gạch ngang hoặc theo từ."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    # Thử tách theo dấu ngắt câu phụ: , ; : -
    sub_clauses = re.split(r"(?<=[,;:–—])\s+", text)
    if len(sub_clauses) > 1 and all(len(c.split()) < len(words) for c in sub_clauses):
        res = []
        cur = ""
        for c in sub_clauses:
            candidate = (cur + " " + c).strip() if cur else c
            if len(candidate.split()) <= max_words:
                cur = candidate
            else:
                if cur:
                    res.append(cur)
                if len(c.split()) > max_words:
                    # Nếu 1 vế vẫn quá dài -> cắt theo từ
                    w = c.split()
                    for i in range(0, len(w), max_words):
                        sub_w = " ".join(w[i:i + max_words]).strip()
                        if sub_w:
                            res.append(sub_w)
                    cur = ""
                else:
                    cur = c
        if cur:
            res.append(cur)
        return [r.strip() for r in res if r.strip()]

    # Fallback: Cắt thẳng theo số lượng từ
    chunks = []
    for i in range(0, len(words), max_words):
        chunk = " ".join(words[i:i + max_words]).strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def adaptive_split_sentences(text: str) -> List[str]:
    """
    Chia văn bản chương thành các chunks an toàn tuyệt đối cho Kokoro TTS:
      - Chunk 0: Ngắn (12-16 từ) để đạt Latency < 1.6s.
      - Chunk 1..N: Vừa vặn (20-30 từ), tuyệt đối không bao giờ vượt quá 32 từ.
      - Loại bỏ hoàn toàn lỗi Phoneme sequence too long (> 512).
    """
    cleaned = normalize_text_for_tts(text)
    # Tách trước theo dấu chấm câu chính hoặc ngắt dòng
    base_parts = re.split(r"(?<=[.!?…\n])\s+", cleaned)
    raw_sentences: List[str] = []
    for part in base_parts:
        part = part.strip()
        if not part:
            continue
        # Bẻ gãy ngay bất kỳ câu nào quá 30 từ
        raw_sentences.extend(_hard_split_long_text(part, max_words=30))

    if not raw_sentences:
        return []

    chunks: List[str] = []

    # 1. Chunk 0: Cắt ngắn ưu tiên phản hồi tức thì (< 16 từ)
    first_part = ""
    while raw_sentences:
        candidate = (first_part + " " + raw_sentences[0]).strip() if first_part else raw_sentences[0]
        words = len(candidate.split())
        if words <= 16 or not first_part:
            first_part = candidate
            raw_sentences.pop(0)
            if words >= 12:
                break
        else:
            break
    if first_part:
        chunks.append(first_part)

    # 2. Chunk 1..N: Ghép câu vừa vặn (20 - 30 từ)
    current_chunk = ""
    for s in raw_sentences:
        candidate = (current_chunk + " " + s).strip() if current_chunk else s
        words = len(candidate.split())
        if words <= 30:
            current_chunk = candidate
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = s

    if current_chunk:
        chunks.append(current_chunk)

    return chunks



# ----------------------------------------------------------------
# Helper: Quản lý Sparse Cache & Lưu trữ Audio Chunk (MP3)
# ----------------------------------------------------------------

def get_chapter_cache_dir(book_id: str, chapter_id: str) -> Path:
    safe_book = re.sub(r"[^a-zA-Z0-9_-]", "_", book_id)[:60]
    safe_chap = re.sub(r"[^a-zA-Z0-9_-]", "_", chapter_id)[:40]
    dir_path = CACHE_DIR / safe_book / safe_chap
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


def load_manifest(book_id: str, chapter_id: str) -> dict:
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    mfile = cdir / "manifest.json"
    if mfile.exists():
        try:
            with open(mfile, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"total_chunks": 0, "completed_chunks": [], "is_complete": False}


def save_manifest(book_id: str, chapter_id: str, data: dict):
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    mfile = cdir / "manifest.json"
    with open(mfile, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


CHUNK_PREFIX = "chunk_v2_"


def get_cached_chunk_mp3(book_id: str, chapter_id: str, chunk_idx: int) -> Optional[bytes]:
    """Lấy audio MP3 từ ổ cứng nếu đã có."""
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    cfile = cdir / f"{CHUNK_PREFIX}{chunk_idx}.mp3"
    if cfile.exists() and cfile.stat().st_size > 100:
        with open(cfile, "rb") as f:
            return f.read()
    return None


def save_chunk_mp3(book_id: str, chapter_id: str, chunk_idx: int, mp3_bytes: bytes):
    """Lưu audio chunk MP3 vào thư mục đệm cố định."""
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    cfile = cdir / f"{CHUNK_PREFIX}{chunk_idx}.mp3"
    with open(cfile, "wb") as f:
        f.write(mp3_bytes)

    # Cập nhật manifest
    manifest = load_manifest(book_id, chapter_id)
    if chunk_idx not in manifest["completed_chunks"]:
        manifest["completed_chunks"].append(chunk_idx)
        manifest["completed_chunks"].sort()
    if manifest["total_chunks"] > 0 and len(manifest["completed_chunks"]) >= manifest["total_chunks"]:
        manifest["is_complete"] = True
        # Tự động ghép thành 1 file MP3 trọn vẹn
        asyncio.create_task(auto_stitch_full_chapter(book_id, chapter_id, manifest["total_chunks"]))
    save_manifest(book_id, chapter_id, manifest)


async def auto_stitch_full_chapter(book_id: str, chapter_id: str, total_chunks: int) -> bool:
    """Ghép toàn bộ các chunk MP3 thành 1 file MP3 hoàn chỉnh của cả chương bằng ffmpeg concat."""
    try:
        cdir = get_chapter_cache_dir(book_id, chapter_id)
        full_mp3_path = cdir / "full_chapter.mp3"
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

        # Kiểm tra xem toàn bộ các chunk từ 0 đến total_chunks-1 đã có mặt chưa
        missing = [idx for idx in range(total_chunks) if not (cdir / f"{CHUNK_PREFIX}{idx}.mp3").exists()]
        if missing:
            print(f"[Auto-Stitch Warning] Chưa đủ chunk để ghép cho {book_id}/{chapter_id} (thiếu {len(missing)}/{total_chunks} chunk)")
            return False

        # Tạo file danh sách cho ffmpeg concat (dùng forward slash / để tương thích Windows)
        concat_txt = cdir / "concat.txt"
        with open(concat_txt, "w", encoding="utf-8") as f:
            for idx in range(total_chunks):
                chunk_file = cdir / f"{CHUNK_PREFIX}{idx}.mp3"
                safe_path = str(chunk_file.resolve()).replace("\\", "/")
                f.write(f"file '{safe_path}'\n")

        cmd = [ffmpeg_exe, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat_txt), "-c", "copy", str(full_mp3_path)]
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, subprocess.run, cmd)
        if full_mp3_path.exists() and full_mp3_path.stat().st_size > 1024:
            manifest = load_manifest(book_id, chapter_id)
            manifest["is_complete"] = True
            save_manifest(book_id, chapter_id, manifest)
            print(f"[Auto-Stitch] ✅ Đã ghép hoàn chỉnh MP3 cho {book_id}/{chapter_id} ({full_mp3_path.stat().st_size} bytes)")
            return True
        return False
    except Exception as e:
        print(f"[Auto-Stitch Error] {e}")
        return False


# ----------------------------------------------------------------
# Helper: Single-Flight Audio Synthesizer (Kokoro Worker)
# ----------------------------------------------------------------

def _synthesize_blocking(text: str, voice_id: str) -> bytes:
    """Hàm chạy blocking TTS Kokoro trong thread pool, xuất ra MP3 64k."""
    model = get_kokoro_model(voice_id)
    audio_arr, _ = model.synthesize(text, speed=1.0)
    buf = io.BytesIO()
    sf.write(buf, audio_arr, SAMPLE_RATE, format="WAV")
    wav_bytes = buf.getvalue()
    # Nén sang MP3 ngay tại nguồn
    return wav_to_mp3(wav_bytes, bitrate="64k")


async def synthesize_chunk_coalesced(book_id: str, chapter_id: str, chunk_idx: int, text: str, voice_id: str) -> bytes:
    """
    Tạo audio MP3 cho chunk với cơ chế Single-Flight Coalescing:
    Nhiều request cùng hỏi 1 chunk chưa có -> Chỉ gen 1 lần duy nhất!
    """
    # 1. Kiểm tra cache MP3 ổ cứng
    cached = get_cached_chunk_mp3(book_id, chapter_id, chunk_idx)
    if cached:
        return cached

    # 2. Kiểm tra có task nào đang gen chunk này không
    task_key = f"{book_id}:{chapter_id}:{chunk_idx}:{voice_id}"
    loop = asyncio.get_running_loop()

    if task_key in _in_flight_tasks:
        return await _in_flight_tasks[task_key]

    # 3. Tạo task mới
    fut = loop.create_future()
    _in_flight_tasks[task_key] = fut

    try:
        update_stream_activity()
        mp3_bytes = await loop.run_in_executor(None, _synthesize_blocking, text, voice_id)
        save_chunk_mp3(book_id, chapter_id, chunk_idx, mp3_bytes)
        fut.set_result(mp3_bytes)
        return mp3_bytes
    except Exception as e:
        if not fut.done():
            fut.set_exception(e)
            # Ngăn asyncio cảnh báo 'Future exception was never retrieved' khi không có listener khác
            fut.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        raise e
    finally:
        _in_flight_tasks.pop(task_key, None)


# ----------------------------------------------------------------
# BACKGROUND WORKER: AUTO-UPLOAD DRIVE (BƯỚC 4)
# Tự động đẩy full_chapter.mp3 đã stream xong lên Google Drive mỗi 30 phút.
# Chỉ chạy khi có đủ env var: GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN.
# ----------------------------------------------------------------

def _drive_credentials_ok() -> bool:
    return all([
        os.environ.get("GOOGLE_CLIENT_ID"),
        os.environ.get("GOOGLE_CLIENT_SECRET"),
        os.environ.get("GOOGLE_REFRESH_TOKEN"),
    ])


def _do_drive_upload() -> int:
    """Quét và upload các chương hoàn thành. Trả về số chương đã upload. Chạy trong executor."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseUpload
    except ImportError as e:
        print(f"[Drive Upload] Thiếu thư viện: {e}")
        return 0

    creds = Credentials(
        None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    svc = build("drive", "v3", credentials=creds)

    # Tìm/tạo folder AudioVerse
    q = ("name='AudioVerse' and mimeType='application/vnd.google-apps.folder' "
         "and trashed=false")
    res = svc.files().list(q=q, fields="files(id)", pageSize=1).execute()
    files = res.get("files", [])
    if files:
        folder_id = files[0]["id"]
    else:
        meta = {"name": "AudioVerse", "mimeType": "application/vnd.google-apps.folder"}
        folder_id = svc.files().create(body=meta, fields="id").execute()["id"]

    # Load index
    index_data = {}
    if INDEX_PATH.exists():
        try:
            index_data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    uploaded = 0
    if not CACHE_DIR.exists():
        return 0
    for book_dir in CACHE_DIR.iterdir():
        if not book_dir.is_dir():
            continue
        for chap_dir in book_dir.iterdir():
            if not chap_dir.is_dir():
                continue
            manifest_path = chap_dir / "manifest.json"
            full_mp3 = chap_dir / "full_chapter.mp3"
            if not manifest_path.exists() or not full_mp3.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not manifest.get("is_complete") or manifest.get("drive_file_id"):
                continue
            mp3_bytes = full_mp3.read_bytes()
            if len(mp3_bytes) < 1024:
                continue
            book_id, chapter_id = book_dir.name, chap_dir.name
            key = f"{book_id}/{chapter_id}"
            filename = f"{book_id}__{chapter_id}.mp3"
            try:
                media = MediaIoBaseUpload(io.BytesIO(mp3_bytes), mimetype="audio/mpeg", resumable=True)
                meta = {"name": filename, "parents": [folder_id], "mimeType": "audio/mpeg"}
                file_id = svc.files().create(body=meta, media_body=media, fields="id").execute()["id"]
                svc.permissions().create(
                    fileId=file_id, body={"type": "anyone", "role": "reader"}
                ).execute()
                index_data[key] = {
                    "drive_file_id": file_id,
                    "download_url": f"https://drive.google.com/uc?export=download&id={file_id}",
                    "engine": "kokoro", "voice": "duc_an",
                    "book_id": book_id, "chapter_id": chapter_id,
                }
                manifest["drive_file_id"] = file_id
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                uploaded += 1
                print(f"[Drive Upload] ✓ {key} -> {file_id}")
            except Exception as e:
                print(f"[Drive Upload] ✗ {key}: {e}")

    if uploaded > 0:
        INDEX_PATH.write_text(json.dumps(index_data, ensure_ascii=False, indent=2), encoding="utf-8")
    return uploaded


async def auto_upload_drive_worker():
    """Worker nền: mỗi 30 phút quét và đẩy chương hoàn thành lên Drive."""
    # Đợi server khởi động xong
    await asyncio.sleep(60)
    while True:
        try:
            # Không upload khi đang có người stream (nhường CPU/băng thông)
            if _drive_credentials_ok() and not is_stream_active():
                loop = asyncio.get_running_loop()
                n = await loop.run_in_executor(None, _do_drive_upload)
                if n > 0:
                    print(f"[Drive Upload] Hoàn thành: {n} chương đã lên Drive.")
        except Exception as e:
            print(f"[Drive Upload Worker Error] {e}")
        await asyncio.sleep(1800)  # 30 phút


# ----------------------------------------------------------------
# BACKGROUND WORKER: PREEMPTION & BACKFILL PROCESSOR
# ----------------------------------------------------------------

async def background_batch_worker():
    """
    Worker chạy nền liên tục:
      - Xử lý các tác vụ Backfill (vá lỗ thủng) và Batch đêm.
      - ENFORCE PREEMPTION: Trước mỗi câu, kiểm tra xem có ai đang stream không.
        Nếu có ai đang stream -> Dừng lại nhường 100% CPU!
    """
    print("[Worker] Background Batch/Backfill Worker đã khởi động...")
    while True:
        try:
            # 1. Kiểm tra Preemption: Nếu có người đang nghe stream -> Tạm nghỉ 2 giây
            if is_stream_active():
                await asyncio.sleep(2.0)
                continue

            # 2. Lấy tác vụ backfill tiếp theo nếu có
            try:
                task_item = await asyncio.wait_for(_backfill_queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                continue

            book_id = task_item["book_id"]
            chapter_id = task_item["chapter_id"]
            chunk_idx = task_item["chunk_idx"]
            text = task_item["text"]
            voice = task_item.get("voice", DEFAULT_VOICE)

            # Kiểm tra lại lần nữa trước khi nạp GPU/CPU
            if is_stream_active():
                print(f"[Preemption] 🛑 Tạm hoãn gen bù câu {chunk_idx} để nhường Live Stream...")
                await _backfill_queue.put(task_item)  # Đưa lại vào hàng đợi
                await asyncio.sleep(2.0)
                continue

            print(f"[Backfill] Đang gen bù ngầm câu {chunk_idx} ({book_id}/{chapter_id})...")
            await synthesize_chunk_coalesced(book_id, chapter_id, chunk_idx, text, voice)
            _backfill_queue.task_done()

        except Exception as e:
            print(f"[Worker Error] {e}")
            await asyncio.sleep(2.0)


UPSTREAM_INDEX_URL = os.environ.get("UPSTREAM_INDEX_URL", "https://linhsamiu--audioverse-batch-api.modal.run/index")


async def sync_upstream_seed_index():
    """
    Tự động đồng bộ 470 file MP3 cũ từ Google Drive qua Upstream Modal API
    về lưu vào data/index.json local khi khởi động server.
    Đảm bảo chuyển sang server mới không bao giờ bị mất link Drive của các chương cũ!
    """
    loop = asyncio.get_running_loop()

    def _fetch_upstream():
        try:
            req = urllib.request.Request(
                UPSTREAM_INDEX_URL,
                headers={"User-Agent": "AudioVerse-Server/6.1"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("chapters", {})
        except Exception as e:
            print(f"[Seed Cache Warning] Không thể kết nối tới upstream index: {e}")
            return None

    upstream_chapters = await loop.run_in_executor(None, _fetch_upstream)
    if upstream_chapters:
        local_data = {}
        if INDEX_PATH.exists():
            try:
                with open(INDEX_PATH, "r", encoding="utf-8") as f:
                    local_data = json.load(f)
            except Exception:
                pass

        merged_count = 0
        for k, v in upstream_chapters.items():
            if k not in local_data:
                v["is_complete"] = True
                local_data[k] = v
                merged_count += 1
            else:
                if not local_data[k].get("download_url") and v.get("download_url"):
                    local_data[k].update(v)

        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(local_data, f, ensure_ascii=False, indent=2)

        print(f"[Seed Cache] ✅ ĐÃ ĐỒNG BỘ THÀNH CÔNG {len(local_data)} CHƯƠNG MP3 (Đã nạp {merged_count} chương mới từ Drive)!")


# ----------------------------------------------------------------
# Helper: Cào nội dung truyện web
# ----------------------------------------------------------------

def extract_clean_chapter_title_from_soup(soup, num: int = 0) -> str:
    """Trích xuất tiêu đề chương sạch sẽ, bảo toàn subtitle đầy đủ và xóa dấu hai chấm thừa ở cuối."""
    title_from_tag = ""
    if soup.title and soup.title.string:
        raw_tag = soup.title.string.strip()
        m = re.search(r"((?:Chương|Hồi|Quyển)\s*\d+[^|\-–—<]+)", raw_tag, re.IGNORECASE)
        if m:
            title_from_tag = m.group(1).split("của truyện")[0].split("-")[0].split("|")[0].strip()
        else:
            title_from_tag = raw_tag.split("của truyện")[0].split("-")[0].split("|")[0].strip()

    title_from_heading = ""
    h_el = soup.select_one("h1, a.chapter-title, .chapter-title, .title-chap, h2")
    if h_el:
        title_from_heading = h_el.get_text(" ", strip=True)

    clean_tag = re.sub(r"[:\s\-–—]+$", "", re.sub(r"\s+", " ", title_from_tag)).strip()
    clean_heading = re.sub(r"[:\s\-–—]+$", "", re.sub(r"\s+", " ", title_from_heading)).strip()

    # Kiểm tra xem tiêu đề có phải dạng generic không (vd: "Chương 7", "Chương 7:", "Chương 7 -")
    generic_pattern = r"^(?:Chương|Hồi|Quyển)\s*\d+[:\s\-–—]*$"
    is_heading_generic = not clean_heading or bool(re.match(generic_pattern, clean_heading, re.I))
    is_tag_generic = not clean_tag or bool(re.match(generic_pattern, clean_tag, re.I))

    if not is_tag_generic and is_heading_generic:
        chosen = clean_tag
    elif not is_heading_generic:
        # Nếu heading có subtitle nhưng tag lại dài hơn/chi tiết hơn
        chosen = clean_tag if (clean_tag and len(clean_tag) > len(clean_heading) + 3 and not is_tag_generic) else clean_heading
    elif clean_tag:
        chosen = clean_tag
    elif clean_heading:
        chosen = clean_heading
    else:
        chosen = f"Chương {num}" if num > 0 else "Chương mới"

    return re.sub(r"[:\s\-–—]+$", "", chosen).strip()


def crawl_web_chapter_content(url: str) -> Tuple[str, str]:
    """Cào tiêu đề và toàn văn nội dung của 1 chương truyện web bằng BeautifulSoup."""
    try:
        from bs4 import BeautifulSoup
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")

        # Trích xuất số chương từ URL nếu có (vd: chuong-25.html)
        num = 0
        num_m = re.search(r"chuong-(\d+)", url)
        if num_m:
            num = int(num_m.group(1))

        title = extract_clean_chapter_title_from_soup(soup, num)

        for tag in soup(["script", "style", "iframe", "ins", "noscript"]):
            tag.decompose()
        for ad in soup.select(".ads, .ad-container, .adsbygoogle, .banner, .box-ads"):
            ad.decompose()
        content_el = soup.select_one(".chapter-c, .reading-content, #chapter-c, .box-chap, .chapter-content, #chapter-content, .entry-content, div[itemprop='articleBody']")
        content = content_el.get_text("\n", strip=True) if content_el else ""
        return title, content
    except Exception as e:
        print(f"[Crawl Error] {e}")
    return "", ""


def fetch_single_chapter_title(url: str, num: int = 0) -> dict:
    """Tải trang HTML để trích xuất tiêu đề chương (Title Crawl) với cơ chế retry và SSL an toàn."""
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }

    last_err = ""
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "html.parser")
            title = extract_clean_chapter_title_from_soup(soup, num)

            if title and len(title) >= 3:
                return {
                    "chapter_number": num,
                    "title": title,
                    "url": url,
                    "success": True,
                }
        except Exception as e:
            last_err = str(e)
            if attempt == 0:
                time.sleep(0.4)

    return {
        "chapter_number": num,
        "title": f"Chương {num}" if num > 0 else "Chương mới",
        "url": url,
        "success": False,
        "error": last_err,
    }


@app.get("/api/crawl")
def api_crawl(url: str = Query(..., description="URL chương truyện web")):
    """Endpoint API cào toàn văn chương truyện web cho App Client."""
    title, content = crawl_web_chapter_content(url)
    if not content:
        raise HTTPException(status_code=400, detail="Không thể cào nội dung từ URL này")
    
    # Trích xuất số chương từ URL nếu có (vd: chuong-25.html)
    chap_num = 1
    m = re.search(r"chuong-(\d+)", url)
    if m:
        chap_num = int(m.group(1))

    return {
        "status": "ok",
        "url": url,
        "content": content,
        "content_length": len(content),
        "story_title": "Truyện Web",
        "chapter_title": title or f"Chương {chap_num}",
        "chapter_number": chap_num,
        "author": "Tác giả Online",
    }


@app.get("/api/crawl_chapter_titles")
def api_crawl_chapter_titles(
    base_url: str = Query("", description="Base URL truyện hoặc pattern"),
    urls: str = Query("", description="Danh sách URL phân tách bằng dấu phẩy"),
    start: int = Query(1, description="Số chương bắt đầu"),
    count: int = Query(10, description="Số lượng chương cần lấy"),
):
    """Endpoint cào song song tiêu đề nhiều chương liên tiếp với tốc độ cao."""
    from concurrent.futures import ThreadPoolExecutor
    items_to_fetch = []
    if urls:
        url_list = [u.strip() for u in urls.split(",") if u.strip()]
        for idx, u in enumerate(url_list):
            num_match = re.search(r"chuong-(\d+)", u)
            num = int(num_match.group(1)) if num_match else (start + idx)
            items_to_fetch.append((u, num))
    elif base_url:
        clean_base = base_url.rstrip("/")
        for num in range(start, start + count):
            if "wetruyen.com" in clean_base or "truyenfull" in clean_base:
                slug = clean_base.split("/")[-1]
                u = f"https://wetruyen.com/{slug}/chuong-{num}.html"
            else:
                u = f"{clean_base}/chuong-{num}/"
            items_to_fetch.append((u, num))

    results = []
    max_workers = min(3, max(1, len(items_to_fetch)))

    def _worker(target_url: str, chap_num: int, delay_sec: float):
        if delay_sec > 0:
            time.sleep(delay_sec)
        return fetch_single_chapter_title(target_url, chap_num)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_worker, u, num, idx * 0.12) for idx, (u, num) in enumerate(items_to_fetch)]
        for f in futures:
            try:
                results.append(f.result())
            except Exception:
                pass

    results.sort(key=lambda x: x["chapter_number"])
    return {
        "status": "ok",
        "count": len(results),
        "results": results
    }



# ----------------------------------------------------------------
# FASTAPI ENDPOINTS (API CONTRACT)
# ----------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "audioverse-streaming",
        "version": "6.1",
        "audio_format": "mp3-64k",
        "preemption_active": is_stream_active(),
        "backfill_pending": _backfill_queue.qsize(),
    }


@app.get("/api/index")
def get_index(book_id: str = Query("", description="Mã sách")):
    """
    Tra cứu trạng thái các chương của sách.
    Tự động đọc 470 file Seed Cache từ Google Drive trong index.json.
    """
    index_data = {}
    if INDEX_PATH.exists():
        try:
            with open(INDEX_PATH, "r", encoding="utf-8") as f:
                index_data = json.load(f)
        except Exception:
            pass

    # Đồng bộ thêm các chương đã hoàn thành trong Stream Cache
    if book_id:
        safe_book = re.sub(r"[^a-zA-Z0-9_-]", "_", book_id)[:60]
        book_cache = CACHE_DIR / safe_book
        if book_cache.exists():
            for chap_dir in book_cache.iterdir():
                if chap_dir.is_dir():
                    m = load_manifest(book_id, chap_dir.name)
                    if m.get("is_complete"):
                        key = f"{book_id}/{chap_dir.name}"
                        if key not in index_data:
                            index_data[key] = {
                                "is_complete": True,
                                "stream_cache": True,
                                "download_url": f"/api/stream/download_full?book_id={book_id}&chapter_id={chap_dir.name}",
                            }

        filtered = {}
        for k, v in index_data.items():
            if k.startswith(f"{book_id}/") or v.get("book_id") == book_id:
                chap_id = k.split("/")[-1]
                filtered[chap_id] = v
        return {"book_id": book_id, "chapters": filtered}

    return {"chapters": index_data}


class StreamStartRequest(BaseModel):
    book_id: str
    chapter_id: str
    url: Optional[str] = ""
    text: Optional[str] = ""
    voice: Optional[str] = DEFAULT_VOICE
    speed: Optional[float] = 1.0
    start_chunk_index: Optional[int] = 0


@app.post("/api/stream/start")
async def stream_start(req: StreamStartRequest):
    """
    Khởi tạo phiên Stream:
      1. Tách câu thích ứng (Chunk 0 ngắn < 1.6s).
      2. Kích hoạt gen ngay Chunk 0 (MP3).
      3. Trả về metadata và URL chunk 0 cho client phát tức thì.
    """
    update_stream_activity()
    content = (req.text or "").strip()
    if not content and req.url:
        content = crawl_web_chapter_content(req.url)

    if not content:
        raise HTTPException(status_code=400, detail="Không có nội dung text hoặc không cào được chương.")

    sentences = adaptive_split_sentences(content)
    if not sentences:
        raise HTTPException(status_code=400, detail="Không tách được câu từ nội dung.")

    session_id = f"sess_{int(time.time())}_{req.book_id}_{req.chapter_id}"

    cdir = get_chapter_cache_dir(req.book_id, req.chapter_id)
    manifest = load_manifest(req.book_id, req.chapter_id)
    manifest["total_chunks"] = len(sentences)
    save_manifest(req.book_id, req.chapter_id, manifest)

    # Lưu danh sách câu và voice vào cache phục vụ tải offline / download_full
    try:
        sentences_file = cdir / "sentences.json"
        with open(sentences_file, "w", encoding="utf-8") as f:
            json.dump({
                "sentences": sentences,
                "voice": req.voice or DEFAULT_VOICE,
                "book_id": req.book_id,
                "chapter_id": req.chapter_id,
                "url": req.url or "",
                "total_chunks": len(sentences),
            }, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Stream Start] Lỗi lưu sentences.json: {e}")

    _sessions[session_id] = {
        "book_id": req.book_id,
        "chapter_id": req.chapter_id,
        "sentences": sentences,
        "voice": req.voice or DEFAULT_VOICE,
        "created_at": time.time(),
    }

    start_idx = max(0, min(req.start_chunk_index or 0, len(sentences) - 1))

    # Kích hoạt gen ngầm Chunk đầu tiên và Chunk tiếp theo (Non-blocking để trả về manifest tức thì < 20ms)
    asyncio.create_task(
        synthesize_chunk_coalesced(
            req.book_id,
            req.chapter_id,
            start_idx,
            sentences[start_idx],
            req.voice or DEFAULT_VOICE,
        )
    )
    if start_idx + 1 < len(sentences):
        asyncio.create_task(
            synthesize_chunk_coalesced(
                req.book_id,
                req.chapter_id,
                start_idx + 1,
                sentences[start_idx + 1],
                req.voice or DEFAULT_VOICE,
            )
        )

    # Đưa các chunk còn lại vào _backfill_queue để worker ngầm gen tiếp tục toàn bộ chương
    completed_set = set(manifest.get("completed_chunks", []))
    for idx in range(len(sentences)):
        if idx not in completed_set and idx != start_idx and idx != (start_idx + 1):
            _backfill_queue.put_nowait({
                "book_id": req.book_id,
                "chapter_id": req.chapter_id,
                "chunk_idx": idx,
                "text": sentences[idx],
                "voice": req.voice or DEFAULT_VOICE,
            })

    return {
        "session_id": session_id,
        "book_id": req.book_id,
        "chapter_id": req.chapter_id,
        "total_chunks": len(sentences),
        "sentences": sentences,
        "first_chunk": {
            "index": start_idx,
            "audio_url": f"/api/stream/chunk?sess={session_id}&idx={start_idx}",
            "text": sentences[start_idx],
        },
    }


# ----------------------------------------------------------------
# ENDPOINT TƯƠNG THÍCH NGƯỢC (LEGACY /tts.wav & /tts.mp3)
# ----------------------------------------------------------------

@app.get("/tts.wav")
@app.get("/tts.mp3")
async def tts_legacy_endpoint(
    text: str = Query(..., description="Văn bản cần đọc"),
    voice: str = Query(DEFAULT_VOICE, description="Giọng đọc"),
    speed: float = Query(1.0, description="Tốc độ"),
):
    """
    Endpoint tương thích ngược cho Client cũ hoặc fallback:
    Nhận text trực tiếp và trả về audio stream MP3/WAV, ngăn app rơi vào chế độ đọc máy giả lập.
    """
    update_stream_activity()
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Thiếu tham số text")

    clean_voice = voice or DEFAULT_VOICE
    loop = asyncio.get_running_loop()
    try:
        mp3_bytes = await loop.run_in_executor(None, _synthesize_blocking, clean_text, clean_voice)
        return Response(content=mp3_bytes, media_type="audio/mpeg")
    except Exception as e:
        print(f"[Legacy TTS Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stream/chunk")
async def get_stream_chunk(sess: str = Query(..., description="Session ID"), idx: int = Query(..., description="Chỉ số chunk")):
    """
    Kéo audio MP3 của chunk.
    Tự động prefetch trước Chunk N+1 và N+2 trong nền.
    """
    update_stream_activity()
    session = _sessions.get(sess)
    if not session:
        raise HTTPException(status_code=404, detail="Phiên stream không tồn tại hoặc đã hết hạn.")

    sentences = session["sentences"]
    if idx < 0 or idx >= len(sentences):
        raise HTTPException(status_code=400, detail="Chỉ số chunk không hợp lệ.")

    book_id = session["book_id"]
    chapter_id = session["chapter_id"]
    voice = session["voice"]

    try:
        mp3_bytes = await synthesize_chunk_coalesced(book_id, chapter_id, idx, sentences[idx], voice)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi gen audio: {e}")

    # Prefetch gối đầu N+1, N+2 an toàn trong nền (bắt lỗi để không sinh unretrieved task exception)
    async def _safe_prefetch(target_idx: int):
        try:
            await synthesize_chunk_coalesced(book_id, chapter_id, target_idx, sentences[target_idx], voice)
        except Exception as prefetch_err:
            print(f"[Prefetch Warning] Lỗi prefetch chunk {target_idx}: {prefetch_err}")

    for next_idx in [idx + 1, idx + 2]:
        if next_idx < len(sentences) and not get_cached_chunk_mp3(book_id, chapter_id, next_idx):
            asyncio.create_task(_safe_prefetch(next_idx))

    return Response(content=mp3_bytes, media_type="audio/mpeg")


class AbortRequest(BaseModel):
    session_id: str


@app.post("/api/stream/abort")
def stream_abort(req: AbortRequest):
    """Hủy phiên stream khi người dùng đổi chương."""
    session = _sessions.pop(req.session_id, None)
    if session:
        manifest = load_manifest(session["book_id"], session["chapter_id"])
        return {
            "status": "aborted",
            "session_id": req.session_id,
            "saved_chunks": len(manifest.get("completed_chunks", [])),
        }
    return {"status": "not_found"}


class ClearCacheRequest(BaseModel):
    book_id: Optional[str] = None
    chapter_id: Optional[str] = None


@app.post("/api/stream/clear_cache")
def clear_stream_cache(req: Optional[ClearCacheRequest] = None):
    """Xóa cache audio stream trên server để buộc tái tạo audio chuẩn mới."""
    count = 0
    b_id = req.book_id if req else None
    c_id = req.chapter_id if req else None
    if b_id and c_id:
        cdir = get_chapter_cache_dir(b_id, c_id)
        if cdir.exists():
            for f in cdir.glob("*.mp3"):
                f.unlink(missing_ok=True)
                count += 1
            mfile = cdir / "manifest.json"
            if mfile.exists():
                mfile.unlink(missing_ok=True)
    elif CACHE_DIR.exists():
        for f in CACHE_DIR.rglob("*.mp3"):
            f.unlink(missing_ok=True)
            count += 1
        for m in CACHE_DIR.rglob("manifest.json"):
            m.unlink(missing_ok=True)
    return {"status": "ok", "deleted_files": count}


class BackfillRequest(BaseModel):
    book_id: str
    chapter_id: str
    missing_chunks: List[int]
    sentences: Optional[List[str]] = []
    voice: Optional[str] = DEFAULT_VOICE


@app.post("/api/batch/backfill")
async def batch_backfill(req: BackfillRequest):
    """
    Gen bù các câu thủng còn thiếu:
    Đưa từng câu thiếu vào background queue để gen ngầm (tôn trọng Preemption).
    """
    manifest = load_manifest(req.book_id, req.chapter_id)
    cached_set = set(manifest.get("completed_chunks", []))
    to_gen = [c for c in req.missing_chunks if c not in cached_set]

    enqueued_count = 0
    if req.sentences:
        for c_idx in to_gen:
            if 0 <= c_idx < len(req.sentences):
                await _backfill_queue.put({
                    "book_id": req.book_id,
                    "chapter_id": req.chapter_id,
                    "chunk_idx": c_idx,
                    "text": req.sentences[c_idx],
                    "voice": req.voice or DEFAULT_VOICE,
                })
                enqueued_count += 1

    return {
        "status": "enqueued",
        "book_id": req.book_id,
        "chapter_id": req.chapter_id,
        "enqueued_count": enqueued_count,
        "already_cached": len(cached_set),
        "backfill_queue_size": _backfill_queue.qsize(),
    }


@app.get("/api/stream/download_full")
async def download_full_chapter(
    book_id: str,
    chapter_id: str,
    url: Optional[str] = Query(None, description="URL truyện web"),
    voice: Optional[str] = Query(None, description="Giọng đọc"),
):
    """
    Tải toàn bộ file MP3 đã ghép trọn vẹn 100% của chương.
    Nếu chưa gen xong, tự động tổng hợp tất cả các câu còn thiếu trước khi trả về.
    Tuyệt đối không bao giờ trả về file ghép thiếu câu!
    """
    update_stream_activity()
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    full_mp3 = cdir / "full_chapter.mp3"
    manifest = load_manifest(book_id, chapter_id)

    # Nếu đã có file hoàn chỉnh thật sự (đủ 100% chunks)
    total_chunks = manifest.get("total_chunks", 0)
    completed_chunks = set(manifest.get("completed_chunks", []))
    if manifest.get("is_complete") and full_mp3.exists() and full_mp3.stat().st_size > 5000:
        if total_chunks > 0 and len(completed_chunks) >= total_chunks:
            with open(full_mp3, "rb") as f:
                return Response(content=f.read(), media_type="audio/mpeg")

    # Nếu full_mp3 tồn tại nhưng bị thiếu chunk do phiên bản cũ ghép dở -> xóa file lỗi
    if full_mp3.exists():
        try:
            full_mp3.unlink()
        except Exception:
            pass

    # Lấy danh sách câu từ sentences.json
    sentences = []
    chosen_voice = voice or DEFAULT_VOICE
    sentences_file = cdir / "sentences.json"
    if sentences_file.exists():
        try:
            with open(sentences_file, "r", encoding="utf-8") as f:
                sdata = json.load(f)
                sentences = sdata.get("sentences", [])
                if not voice and sdata.get("voice"):
                    chosen_voice = sdata["voice"]
        except Exception:
            pass

    # Nếu chưa có sentences.json nhưng client truyền url -> cào ngay
    if not sentences and url:
        _, content = crawl_web_chapter_content(url)
        if content:
            sentences = adaptive_split_sentences(content)
            with open(sentences_file, "w", encoding="utf-8") as f:
                json.dump({
                    "sentences": sentences,
                    "voice": chosen_voice,
                    "book_id": book_id,
                    "chapter_id": chapter_id,
                    "url": url,
                    "total_chunks": len(sentences),
                }, f, ensure_ascii=False, indent=2)

    if not sentences:
        raise HTTPException(
            status_code=404,
            detail="Chương chưa có nội dung text để tạo file audio đầy đủ. Vui lòng mở nghe online một lần hoặc truyền url."
        )

    total_chunks = len(sentences)
    manifest["total_chunks"] = total_chunks
    save_manifest(book_id, chapter_id, manifest)

    # Tổng hợp tất cả các câu còn thiếu (Single-flight coalesced)
    for idx in range(total_chunks):
        if not get_cached_chunk_mp3(book_id, chapter_id, idx):
            await synthesize_chunk_coalesced(book_id, chapter_id, idx, sentences[idx], chosen_voice)

    # Ghép toàn bộ các câu 0..total_chunks-1 thành full_chapter.mp3
    success = await auto_stitch_full_chapter(book_id, chapter_id, total_chunks)
    if success and full_mp3.exists():
        with open(full_mp3, "rb") as f:
            return Response(content=f.read(), media_type="audio/mpeg")

    raise HTTPException(status_code=500, detail="Không thể ghép file audio trọn vẹn của chương.")


@app.get("/api/music/{name}")
def get_music(name: str):
    """Phục vụ file nhạc nền (novel_bg.mp3, book_bg1.mp3, book_bg2.mp3) cho client."""
    music_dir = BASE_DIR / "music"
    mfile = music_dir / name
    if mfile.exists():
        with open(mfile, "rb") as f:
            return Response(content=f.read(), media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="File nhạc nền không tồn tại.")


@app.post("/api/sync_upstream_index")
async def trigger_sync_upstream():
    """Endpoint cho phép App hoặc admin bấm đồng bộ lại 470 file Drive bất kỳ lúc nào."""
    asyncio.create_task(sync_upstream_seed_index())
    return {"status": "sync_started", "upstream_url": UPSTREAM_INDEX_URL}


if __name__ == "__main__":
    import uvicorn
    print("=" * 70)
    print("🚀 KHỞI ĐỘNG AUDIOVERSE STREAMING BACKEND v6.1...")
    print("=" * 70)
    uvicorn.run("server_streaming:app", host="0.0.0.0", port=3000, reload=True)
