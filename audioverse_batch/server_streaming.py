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
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Set

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

# Khởi tạo FastAPI
app = FastAPI(title="AudioVerse Streaming API", version="6.1")

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

def adaptive_split_sentences(text: str) -> List[str]:
    """
    Chia văn bản chương thành các chunks tối ưu theo benchmark:
      - Chunk 0: Ngắn (15-18 từ) để đạt Latency < 1.6s.
      - Chunk 1..N: Vừa (28-38 từ) để ngữ điệu mượt và dôi dư buffer > 3s.
    """
    cleaned = normalize_text_for_tts(text)
    raw_sentences = re.split(r"(?<=[.!?…])\s+", cleaned)
    raw_sentences = [s.strip() for s in raw_sentences if s.strip()]

    if not raw_sentences:
        return []

    chunks: List[str] = []
    
    # 1. Chunk 0: Cắt ngắn ưu tiên phản hồi tức thì
    first_part = ""
    while raw_sentences:
        candidate = (first_part + " " + raw_sentences[0]).strip() if first_part else raw_sentences[0]
        words = len(candidate.split())
        if words <= 18 or not first_part:
            first_part = candidate
            raw_sentences.pop(0)
            if words >= 14:
                break
        else:
            break
    chunks.append(first_part)

    # 2. Chunk 1..N: Ghép câu vừa vặn (25 - 38 từ)
    current_chunk = ""
    for s in raw_sentences:
        candidate = (current_chunk + " " + s).strip() if current_chunk else s
        words = len(candidate.split())
        if words <= 35:
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


def get_cached_chunk_mp3(book_id: str, chapter_id: str, chunk_idx: int) -> Optional[bytes]:
    """Lấy audio MP3 từ ổ cứng nếu đã có."""
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    cfile = cdir / f"chunk_{chunk_idx}.mp3"
    if cfile.exists() and cfile.stat().st_size > 100:
        with open(cfile, "rb") as f:
            return f.read()
    return None


def save_chunk_mp3(book_id: str, chapter_id: str, chunk_idx: int, mp3_bytes: bytes):
    """Lưu audio chunk MP3 vào thư mục đệm cố định."""
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    cfile = cdir / f"chunk_{chunk_idx}.mp3"
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


async def auto_stitch_full_chapter(book_id: str, chapter_id: str, total_chunks: int):
    """Ghép toàn bộ các chunk MP3 thành 1 file MP3 hoàn chỉnh của cả chương."""
    try:
        cdir = get_chapter_cache_dir(book_id, chapter_id)
        full_mp3_path = cdir / "full_chapter.mp3"
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

        # Tạo file danh sách cho ffmpeg concat
        concat_txt = cdir / "concat.txt"
        with open(concat_txt, "w", encoding="utf-8") as f:
            for idx in range(total_chunks):
                chunk_file = cdir / f"chunk_{idx}.mp3"
                if chunk_file.exists():
                    f.write(f"file '{chunk_file.resolve()}'\n")

        cmd = [ffmpeg_exe, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat_txt), "-c", "copy", str(full_mp3_path)]
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, subprocess.run, cmd)
        if full_mp3_path.exists():
            print(f"[Auto-Stitch] ✅ Đã ghép hoàn chỉnh MP3 cho {book_id}/{chapter_id} ({full_mp3_path.stat().st_size} bytes)")
    except Exception as e:
        print(f"[Auto-Stitch Error] {e}")


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
        fut.set_exception(e)
        raise e
    finally:
        _in_flight_tasks.pop(task_key, None)


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


@app.on_event("startup")
async def startup_event():
    # 1. Khởi chạy background worker (Preemption & Backfill)
    asyncio.create_task(background_batch_worker())
    # 2. Tự động đồng bộ 470 file MP3 Seed Cache từ Google Drive
    asyncio.create_task(sync_upstream_seed_index())


# ----------------------------------------------------------------
# Helper: Cào nội dung truyện web
# ----------------------------------------------------------------

def crawl_web_chapter_content(url: str) -> str:
    """Cào text của 1 chương truyện web."""
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
        for tag in soup(["script", "style", "iframe", "ins"]):
            tag.decompose()
        content_el = soup.select_one(".chapter-c, .reading-content, #chapter-c, .box-chap")
        if content_el:
            return content_el.get_text("\n", strip=True)
    except Exception as e:
        print(f"[Crawl Error] {e}")
    return ""


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

    manifest = load_manifest(req.book_id, req.chapter_id)
    manifest["total_chunks"] = len(sentences)
    save_manifest(req.book_id, req.chapter_id, manifest)

    _sessions[session_id] = {
        "book_id": req.book_id,
        "chapter_id": req.chapter_id,
        "sentences": sentences,
        "voice": req.voice or DEFAULT_VOICE,
        "created_at": time.time(),
    }

    start_idx = max(0, min(req.start_chunk_index or 0, len(sentences) - 1))

    # Gen ngay Chunk đầu tiên
    try:
        await synthesize_chunk_coalesced(
            req.book_id,
            req.chapter_id,
            start_idx,
            sentences[start_idx],
            req.voice or DEFAULT_VOICE,
        )
    except Exception as e:
        print(f"[Stream Start] Lỗi gen chunk {start_idx}: {e}")

    # Prefetch trước Chunk tiếp theo trong background
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

    # Prefetch gối đầu N+1, N+2
    for next_idx in [idx + 1, idx + 2]:
        if next_idx < len(sentences) and not get_cached_chunk_mp3(book_id, chapter_id, next_idx):
            asyncio.create_task(
                synthesize_chunk_coalesced(book_id, chapter_id, next_idx, sentences[next_idx], voice)
            )

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
def download_full_chapter(book_id: str, chapter_id: str):
    """Tải toàn bộ file MP3 đã ghép của chương."""
    cdir = get_chapter_cache_dir(book_id, chapter_id)
    full_mp3 = cdir / "full_chapter.mp3"
    if full_mp3.exists():
        with open(full_mp3, "rb") as f:
            return Response(content=f.read(), media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Chương chưa được ghép hoàn chỉnh.")


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
