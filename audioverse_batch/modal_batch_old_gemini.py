"""
AudioVerse batch TTS pipeline (chay tren Modal) — "nha may" audio.

Khong stream realtime nua. Moi dem 3h sang (gio VN), cron:
  1. Doc hang doi chuong can gen tu Volume.
  2. Tu lay noi dung: cao URL truyen / tra text sach trong Volume.
  3. TRUYEN (web novel) -> Gemini TTS (giong Zubenelgenubi).
     SACH (PDF)        -> Kokoro in-process (giong duc_an).
  4. Convert MP3 -> upload len thu muc AudioVerse tren Google Drive.
  5. Cap nhat index.json.

App vao THANG Drive lay MP3 nghe (stream hoac tai ve may tuy cau hinh),
khong qua Modal nua.

Setup (1 lan, tren PC):
  1. modal secret create gemini-api-key GEMINI_API_KEY=<key>
     (lay key: https://aistudio.google.com/app/apikey)
  2. Chay drive_oauth.py -> modal secret create google-drive-oauth ...
     (xem HUONG_DAN_BATCH.md)
  3. Dam bao Volume model Kokoro da co (da chay modal_kokoro.py::download_model 1 lan)
  4. modal deploy modal_batch.py

API cho app:
  POST /import_book  {"drive_url": "...", "title": "..."} -> {book_id, title, chapters:[{id,title,chars}]}
  POST /import_novel {"url": "..."} -> {book_id, title}
  POST /enqueue      {"items": [{book_id, chapter_id, title, url?, engine, voice?}], "position": "back"|"front"}
  POST /queue/move   {"book_id": "...", "chapter_id": "...", "direction": "up"|"down"}
  POST /queue/remove {"book_id": "...", "chapter_id": "..."}
  POST /trigger      {"max_chapters": 10} -> chay batch ngay lap tuc (nen)
  GET  /queue?book_id=...  -> {queue: [{book_id, chapter_id, title, engine}...]} (thu tu = do uu tien)
  GET  /index?book_id=...  -> {chapters: {chapter_id: {drive_file_id, download_url, ...}}}
  POST /remove_book {"book_id": "..."}
  GET  /status -> {pending, done, voice}
  GET  /health
"""

import modal

app = modal.App("audioverse-batch")

vol = modal.Volume.from_name("audioverse-batch", create_if_missing=True)
kokoro_vol = modal.Volume.from_name("audioverse-kokoro-data")  # da co model tu app kokoro
DATA_DIR = "/data"
MODEL_DIR = "/models"
QUEUE_PATH = "/data/queue.json"
INDEX_PATH = "/data/index.json"
BOOKS_DIR = "/data/books"

# --- Cau hinh ---
GEMINI_MODEL = "gemini-3.8-flash-tts"
GEMINI_VOICE = "Zubenelgenubi"  # giong truyen (da test, co nhan am)
GEMINI_STYLE = "Style: Rich, velvety, unhurried audiobook narration setting an atmospheric evening scene."
KOKORO_VOICE = "duc_an"  # giong sach (Nguyen chon)
MAX_GEMINI_PER_RUN = 10   # giu duoi RPD free (~15/ngay)
MAX_KOKORO_PER_RUN = 20   # Kokoro khong dinh quota Google, chi ton credit Modal
MAX_CHARS_PER_GEMINI_REQUEST = 20000
DRIVE_FOLDER_NAME = "AudioVerse"
CRON_SCHEDULE = "0 20 * * *"  # 3h sang gio VN = 20h UTC

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.109.0",
        "uvicorn>=0.27.0",
        "onnxruntime>=1.17.0",
        "torch>=2.1.0",
        "soundfile>=0.12.1",
        "huggingface_hub>=0.20.0",
        "vig2p>=0.1.0",
        "beautifulsoup4>=4.12.0",
        "numpy>=1.24.0,<2.0.0",
        "requests",
        "google-api-python-client",
        "google-auth",
        "imageio-ffmpeg",
        "pypdf",
    )
    .add_local_python_source("kokoro_vietnamese")
)

_SECRETS = [
    modal.Secret.from_name("gemini-api-key"),
    modal.Secret.from_name("google-drive-oauth"),
]
_VOLUMES = {DATA_DIR: vol, MODEL_DIR: kokoro_vol}


class QuotaExhausted(Exception):
    pass


# ---------------------------------------------------------------- JSON helpers

def _load_json(path, default):
    import json
    import os

    try:
        vol.reload()
    except Exception:
        pass

    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, obj):
    import json
    import os

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def _book_path(book_id: str) -> str:
    import re

    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", book_id)[:80]
    return f"{BOOKS_DIR}/{safe}.json"


# ---------------------------------------------------------------- Gemini TTS

def _wav_wrap_pcm(pcm: bytes, sample_rate=24000) -> bytes:
    import struct

    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE", b"fmt ", 16, 1, 1,
        sample_rate, sample_rate * 2, 2, 16, b"data", data_size,
    )
    return header + pcm


def _parse_audio_mime_type(mime_type: str):
    bits_per_sample, rate = 16, 24000
    for param in (mime_type or "").split(";"):
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate = int(param.split("=", 1)[1])
            except (ValueError, IndexError):
                pass
        elif param.startswith("audio/L"):
            try:
                bits_per_sample = int(param.split("L", 1)[1])
            except (ValueError, IndexError):
                pass
    return bits_per_sample, rate


def gemini_synthesize(text: str, api_key: str) -> bytes:
    import base64

    import requests

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    # Style dieu khien qua prompt (cach tai lieu ho tro):
    # model doc theo phong cach nay ma khong doc toan bo chi dan.
    styled_text = (
        "Read the following text aloud in this style: rich, velvety, unhurried audiobook "
        "narration setting an atmospheric evening scene. Do not read this instruction aloud.\n\n"
        + text
    )
    body = {
        "contents": [{
            "role": "user",
            "parts": [{"text": styled_text}],
        }],
        "generationConfig": {
            "temperature": 1,
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": GEMINI_VOICE}}
            },
        },
    }
    r = requests.post(
        url,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=600,
    )
    if r.status_code == 429:
        raise QuotaExhausted("Gemini 429 - het quota free hom nay")
    r.raise_for_status()
    data = r.json()
    audio_b64, mime_type = None, ""
    debug_texts = []
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or {}
            if inline.get("data"):
                audio_b64 = inline["data"]
                mime_type = inline.get("mimeType", "")
            elif part.get("text"):
                debug_texts.append(part["text"][:300])
    if not audio_b64:
        fb = data.get("promptFeedback", {})
        finish = [c.get("finishReason") for c in data.get("candidates", [])]
        raise RuntimeError(
            "Khong tim thay audio trong response Gemini. "
            f"finishReason={finish}, promptFeedback={str(fb)[:200]}, "
            f"text_tra_ve={debug_texts[:1]}"
        )
    raw = base64.b64decode(audio_b64)
    if raw[:4] != b"RIFF":
        _, rate = _parse_audio_mime_type(mime_type)
        raw = _wav_wrap_pcm(raw, sample_rate=rate)
    return raw


# ---------------------------------------------------------------- Kokoro in-process

_kokoro_models: dict = {}


def get_kokoro(voice_id: str):
    from kokoro_vietnamese.core import DEFAULT_VOICE, VOICES
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX

    clean = (voice_id or "").lower().replace("kokoro_", "").strip()
    if clean not in VOICES:
        clean = DEFAULT_VOICE
    if clean not in _kokoro_models:
        print(f"[batch] Nap model Kokoro giong: {clean}...")
        _kokoro_models[clean] = KokoroVietnameseONNX(
            voice=clean,
            onnx_path=f"{MODEL_DIR}/kokoro_vi.onnx",
            config_path=f"{MODEL_DIR}/config.json",
            voicepack_path=f"{MODEL_DIR}/{VOICES[clean]['filename']}",
            device="cpu",
        )
    return _kokoro_models[clean]


def kokoro_synthesize(text: str, voice_id: str = KOKORO_VOICE) -> bytes:
    """Doc nguyen chuong bang Kokoro (tu chia doan trong). Tra ve WAV 24kHz."""
    import io

    import soundfile as sf

    model = get_kokoro(voice_id)
    audio, _ = model.synthesize(text.strip(), speed=1.0)
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    return buf.getvalue()


# ---------------------------------------------------------------- Crawl truyen

def crawl_chapter(url: str) -> dict:
    """Cao 1 chuong truyen web. Tra ve {story_title, chapter_title, content}."""
    import re
    import urllib.parse
    import urllib.request

    from bs4 import BeautifulSoup

    raw_url = url.strip()
    headers = {
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"),
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    }

    def fetch(u):
        req = urllib.request.Request(u, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.read().decode("utf-8", errors="ignore"), resp.geturl()

    slug_match = re.search(
        r"(?:truyenfull\.[a-z]+|dtruyen\.com|wetruyen\.com|metruyencv\.com)/([a-zA-Z0-9_-]+)",
        raw_url,
    )
    slug = slug_match.group(1) if slug_match else ""
    urls_to_try = []
    if ("truyenfull" in raw_url or "wetruyen" in raw_url) and slug:
        urls_to_try.append(f"https://wetruyen.com/{slug}/chuong-1.html")
    urls_to_try.append(raw_url)

    html, final_url, last_err = None, raw_url, None
    for u in urls_to_try:
        try:
            html, final_url = fetch(u)
            if html:
                break
        except Exception as e:
            last_err = e
    if not html:
        raise RuntimeError(f"Khong tai duoc trang truyen: {last_err or raw_url}")

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "iframe", "ins"]):
        tag.decompose()

    def pick_text(selectors):
        for sel in selectors:
            el = soup.select_one(sel)
            if el:
                t = el.get_text(" ", strip=True)
                if len(t) > 3:
                    return t
        return ""

    story_title = pick_text(["h1", ".truyen-title", ".story-title"])
    chapter_title = pick_text([".chapter-title", "h2", ".chr-title"])

    # Neu dang o trang chuong ma story_title trung ten chuong (h1 la ten chuong):
    # tach ten truyen that tu <title> dang "Chuong X ... cua truyen TEN TRUYEN"
    if re.match(r"(?i)^\s*(chương|chuong|hồi|hoi|tập|tap)\b", story_title or ""):
        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
        if m:
            mt = re.search(r"của truyện\s+(.+?)\s*$", m.group(1).strip(), re.I)
            if mt:
                story_title = mt.group(1).strip()

    content = ""
    for sel in ["#chapter-c", ".chapter-c", "#chapter-content", ".chapter-content",
                "#chr-content", ".box-chap", "#vungdoc", ".entry-content", "article"]:
        el = soup.select_one(sel)
        if el:
            t = el.get_text("\n", strip=True)
            if len(t) > 200:
                content = t
                break
    if not content:
        best, best_len = "", 0
        for div in soup.find_all(["div", "article"]):
            t = div.get_text("\n", strip=True)
            if len(t) > best_len and len(t) > 300:
                best, best_len = t, len(t)
        content = best

    junk = ["truyenfull", "tangthuvien", "dtruyen", "quảng cáo", "bình luận", "donate"]
    lines = []
    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue
        if any(j in line.lower() for j in junk) and len(line) < 120:
            continue
        lines.append(line)
    content = "\n".join(lines)

    if not content or len(content) < 100:
        raise RuntimeError("Khong boc tach duoc noi dung chuong")
    if not story_title:
        story_title = (soup.title.get_text(strip=True)[:80] if soup.title else "Truyện web")
    if not chapter_title:
        m = urllib.parse.urlparse(final_url).path.rstrip("/").split("/")[-1]
        chapter_title = m.replace("-", " ").title() or "Chương mới"
    return {"story_title": story_title, "chapter_title": chapter_title, "content": content}


# ---------------------------------------------------------------- PDF sach

def normalize_drive_url(url: str) -> str:
    """Dua link Drive bat ky ve dang tai truc tiep."""
    import re

    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if not m:
        m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        return url
    return f"https://drive.google.com/uc?export=download&id={m.group(1)}"


def download_pdf(url: str) -> bytes:
    import requests

    dl = normalize_drive_url(url)
    # 2 buoc: Drive co the tra trang xac nhan virus-scan voi file lon
    sess = requests.Session()
    r = sess.get(dl, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    if "text/html" in r.headers.get("Content-Type", ""):
        import re

        m = re.search(r'href="(/uc\?export=download[^"]*confirm[^"]*)"', r.text)
        if m:
            r = sess.get("https://drive.google.com" + m.group(1), timeout=120)
            r.raise_for_status()
    data = r.content
    if not data.startswith(b"%PDF"):
        raise RuntimeError("Tai ve khong phai file PDF (link co the khong public)")
    return data


def extract_pdf_text(pdf_bytes: bytes) -> list:
    """Tra ve list text theo tung trang."""
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = []
    for p in reader.pages:
        try:
            pages.append(p.extract_text() or "")
        except Exception:
            pages.append("")
    return pages


_CHAPTER_RE = None


def _chapter_pattern():
    global _CHAPTER_RE
    if _CHAPTER_RE is None:
        import re

        _CHAPTER_RE = re.compile(
            r"(?im)^\s*(chương|chuong|hồi|hoi|quyển|quyen|phần|phan|tập|tap)"
            r"\s+([0-9ivxlc]+)[\s:.\-–—]*([^\n]{0,60})"
        )
    return _CHAPTER_RE


def split_book_chapters(pages: list) -> list:
    """Tach text sach thanh chuong. Fallback: cum 25 trang/chuong."""
    import re

    full = "\n".join(pages)
    matches = list(_chapter_pattern().finditer(full))
    chapters = []
    if len(matches) >= 2:
        for i, m in enumerate(matches):
            start = m.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(full)
            num = m.group(2)
            rest = (m.group(3) or "").strip()
            title = f"{m.group(1).capitalize()} {num}" + (f": {rest}" if rest else "")
            text = full[start:end].strip()
            # Bo dong tieu de khoi text de khong doc lap
            text = re.sub(r"(?im)^\s*" + re.escape(m.group(0)).strip() + r"\s*\n?", "", text, count=1).strip()
            if len(text) > 300:
                chapters.append({"id": f"c{i + 1}", "title": title, "text": text})
    if not chapters:
        # Fallback: cum 25 trang lam 1 chuong
        chunk_pages, idx = 25, 0
        for i in range(0, len(pages), chunk_pages):
            idx += 1
            text = "\n".join(pages[i:i + chunk_pages]).strip()
            if len(text) > 300:
                chapters.append({"id": f"c{idx}", "title": f"Phần {idx}", "text": text})
    return chapters


# ---------------------------------------------------------------- Audio utils

def wav_to_mp3(wav_bytes: bytes) -> bytes:
    import os
    import subprocess
    import tempfile

    import imageio_ffmpeg

    exe = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as d:
        wav_path = os.path.join(d, "in.wav")
        mp3_path = os.path.join(d, "out.mp3")
        with open(wav_path, "wb") as f:
            f.write(wav_bytes)
        subprocess.run(
            [exe, "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "6", mp3_path],
            check=True, capture_output=True,
        )
        with open(mp3_path, "rb") as f:
            return f.read()


# ---------------------------------------------------------------- Google Drive

def drive_service():
    import os

    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    return build("drive", "v3", credentials=creds)


def ensure_drive_folder(svc) -> str:
    q = (f"name='{DRIVE_FOLDER_NAME}' and "
         f"mimeType='application/vnd.google-apps.folder' and trashed=false")
    res = svc.files().list(q=q, fields="files(id)", pageSize=1).execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": DRIVE_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}
    return svc.files().create(body=meta, fields="id").execute()["id"]


def drive_upload_mp3(svc, folder_id: str, filename: str, mp3_bytes: bytes) -> str:
    import io

    from googleapiclient.http import MediaIoBaseUpload

    media = MediaIoBaseUpload(io.BytesIO(mp3_bytes), mimetype="audio/mpeg", resumable=True)
    meta = {"name": filename, "parents": [folder_id], "mimeType": "audio/mpeg"}
    return svc.files().create(body=meta, media_body=media, fields="id").execute()["id"]


# ---------------------------------------------------------------- Batch core

def _split_long_text(text: str):
    if len(text) <= MAX_CHARS_PER_GEMINI_REQUEST:
        return [text]
    parts, cur = [], ""
    for chunk in text.replace("\r", "").split("\n\n"):
        if len(cur) + len(chunk) + 2 > MAX_CHARS_PER_GEMINI_REQUEST and cur:
            parts.append(cur)
            cur = ""
        cur = (cur + "\n\n" + chunk).strip()
    if cur:
        parts.append(cur)
    return parts


def resolve_item_text(item: dict) -> str:
    """Lay text chuong: tu text gui thang / cao URL / tra Volume sach."""
    if item.get("text") and len(item["text"].strip()) > 100:
        return item["text"].strip()
    if item.get("url"):
        return crawl_chapter(item["url"])["content"]
    book = _load_json(_book_path(item.get("book_id", "")), None)
    if book:
        for ch in book.get("chapters", []):
            if ch["id"] == item.get("chapter_id"):
                return ch["text"]
    raise RuntimeError("Khong tim thay noi dung chuong (thieu url/text)")


def _run_batch(max_gemini: int = MAX_GEMINI_PER_RUN, max_kokoro: int = MAX_KOKORO_PER_RUN):
    import os

    queue = _load_json(QUEUE_PATH, [])
    index = _load_json(INDEX_PATH, {})
    if not queue:
        print("[batch] Hang doi trong.")
        return {"done": 0}

    api_key = os.environ.get("GEMINI_API_KEY", "")
    svc = drive_service()
    folder_id = ensure_drive_folder(svc)

    gemini_used, kokoro_used, done, skipped = 0, 0, 0, 0
    remaining = list(queue)

    for item in list(queue):
        key = f"{item['book_id']}/{item['chapter_id']}"
        engine = item.get("engine", "gemini")
        voice = item.get("voice") or (KOKORO_VOICE if engine == "kokoro" else GEMINI_VOICE)

        # Da co audio dung engine+giong -> bo qua
        existing = index.get(key)
        if existing and existing.get("engine") == engine and existing.get("voice") == voice:
            remaining.remove(item)
            skipped += 1
            continue
        if engine == "gemini" and gemini_used >= max_gemini:
            continue
        if engine == "kokoro" and kokoro_used >= max_kokoro:
            continue

        print(f"[batch] Gen {key} [{engine}/{voice}]...")
        try:
            text = resolve_item_text(item)
        except Exception as e:
            print(f"[batch] Khong lay duoc text {key}: {e}")
            remaining.remove(item)
            continue

        try:
            if engine == "kokoro":
                wav = kokoro_synthesize(text, voice)
                kokoro_used += 1
            else:
                # Gemini: chuong dai cat nho (moi part 1 request)
                parts = _split_long_text(text)
                import io as _io

                import soundfile as _sf

                wavs = []
                for p in parts:
                    wavs.append(gemini_synthesize(p, api_key))
                    gemini_used += 1
                if len(wavs) == 1:
                    wav = wavs[0]
                else:
                    import numpy as _np

                    arrays = []
                    for w in wavs:
                        data, _ = _sf.read(_io.BytesIO(w))
                        arrays.append(data)
                    buf = _io.BytesIO()
                    _sf.write(buf, _np.concatenate(arrays), 24000, format="WAV")
                    wav = buf.getvalue()
        except QuotaExhausted as e:
            print(f"[batch] {e} - dung Gemini, lam tiep Kokoro.")
            continue
        except Exception as e:
            print(f"[batch] Loi synth {key}: {e}")
            remaining.remove(item)
            continue

        try:
            mp3 = wav_to_mp3(wav)
        except Exception as e:
            print(f"[batch] Loi convert MP3 {key}: {e}")
            remaining.remove(item)
            continue

        # Xoa file Drive cu neu gen lai (doi giong)
        if existing and existing.get("drive_file_id"):
            try:
                svc.files().delete(fileId=existing["drive_file_id"]).execute()
            except Exception:
                pass

        fname = f"{item['book_id']}__{item['chapter_id']}.mp3"
        try:
            file_id = drive_upload_mp3(svc, folder_id, fname, mp3)
        except Exception as e:
            print(f"[batch] Loi upload {key}: {e}")
            continue

        index[key] = {
            "drive_file_id": file_id,
            "download_url": f"https://drive.google.com/uc?export=download&id={file_id}",
            "engine": engine,
            "voice": voice,
            "title": item.get("title", ""),
            "book_id": item["book_id"],
            "chapter_id": item["chapter_id"],
        }
        remaining.remove(item)
        done += 1
        print(f"[batch] Xong {key} ({len(mp3) // 1024} KB).")
        _save_json(QUEUE_PATH, remaining)
        _save_json(INDEX_PATH, index)
        vol.commit()

    print(f"[batch] Hoan tat: {done} moi, {skipped} da co, con {len(remaining)} cho.")
    return {"done": done, "skipped": skipped, "remaining": len(remaining)}


@app.function(
    image=image,
    volumes=_VOLUMES,
    secrets=_SECRETS,
    cpu=2.0,
    memory=2048,
    schedule=modal.Cron(CRON_SCHEDULE),
    timeout=14400,
)
def batch_nightly(max_gemini: int = MAX_GEMINI_PER_RUN):
    return _run_batch(max_gemini=max_gemini)


# ---------------------------------------------------------------- Web API

@app.function(image=image, volumes=_VOLUMES, secrets=_SECRETS, timeout=300)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Response

    web_app = FastAPI()

    @web_app.get("/health")
    def health():
        return {"status": "ok", "service": "audioverse-batch"}

    @web_app.get("/status")
    def status():
        queue = _load_json(QUEUE_PATH, [])
        index = _load_json(INDEX_PATH, {})
        return {
            "pending": len(queue),
            "done": len(index),
            "gemini_voice": GEMINI_VOICE,
            "kokoro_voice": KOKORO_VOICE,
        }

    @web_app.get("/queue")
    def get_queue(book_id: str = ""):
        """App xem hang doi (thu tu = do uu tien). Co the loc theo sach."""
        queue = _load_json(QUEUE_PATH, [])
        items = queue if not book_id else [it for it in queue if it.get("book_id") == book_id]
        return {
            "queue": [
                {
                    "book_id": it.get("book_id"),
                    "chapter_id": it.get("chapter_id"),
                    "title": it.get("title", ""),
                    "engine": it.get("engine", "gemini"),
                }
                for it in items
            ],
            "total": len(items),
        }

    @web_app.post("/queue/move")
    def queue_move(payload: dict):
        """Doi do uu tien: dua 1 chuong len/xuong trong hang doi."""
        book_id = ((payload or {}).get("book_id") or "").strip()
        chapter_id = ((payload or {}).get("chapter_id") or "").strip()
        direction = ((payload or {}).get("direction") or "").strip()  # up | down
        queue = _load_json(QUEUE_PATH, [])
        idx = next((i for i, it in enumerate(queue)
                    if it.get("book_id") == book_id and it.get("chapter_id") == chapter_id), -1)
        if idx < 0:
            return Response(content='{"error": "not in queue"}', status_code=404,
                            media_type="application/json")
        new_idx = idx
        if direction == "up" and idx > 0:
            queue[idx - 1], queue[idx] = queue[idx], queue[idx - 1]
            new_idx = idx - 1
        elif direction == "down" and idx < len(queue) - 1:
            queue[idx + 1], queue[idx] = queue[idx], queue[idx + 1]
            new_idx = idx + 1
        _save_json(QUEUE_PATH, queue)
        vol.commit()
        return {"moved": True, "position": new_idx}

    @web_app.post("/queue/remove")
    def queue_remove(payload: dict):
        """Xoa 1 chuong khoi hang doi."""
        book_id = ((payload or {}).get("book_id") or "").strip()
        chapter_id = ((payload or {}).get("chapter_id") or "").strip()
        queue = _load_json(QUEUE_PATH, [])
        before = len(queue)
        queue = [it for it in queue
                 if not (it.get("book_id") == book_id and it.get("chapter_id") == chapter_id)]
        _save_json(QUEUE_PATH, queue)
        vol.commit()
        return {"removed": before - len(queue)}

    @web_app.post("/import_book")
    def import_book(payload: dict):
        """Nhap sach PDF tu link Drive: tai -> extract -> tach chuong -> luu Volume."""
        import hashlib
        import time

        drive_url = ((payload or {}).get("drive_url") or "").strip()
        title = ((payload or {}).get("title") or "").strip()
        if not drive_url:
            return Response(content='{"error": "no drive_url"}', status_code=400,
                            media_type="application/json")
        print(f"[import_book] Tai PDF: {drive_url[:80]}...")
        pdf_bytes = download_pdf(drive_url)
        pages = extract_pdf_text(pdf_bytes)
        full_len = sum(len(p) for p in pages)
        if full_len < 500:
            return Response(content='{"error": "PDF khong co text (co the la scan)"}',
                            status_code=400, media_type="application/json")
        chapters = split_book_chapters(pages)
        if not chapters:
            return Response(content='{"error": "khong tach duoc chuong"}',
                            status_code=400, media_type="application/json")
        book_id = "b" + hashlib.md5(drive_url.encode()).hexdigest()[:10]
        if not title:
            title = f"Sách {book_id}"
        _save_json(_book_path(book_id), {
            "book_id": book_id,
            "title": title,
            "source_url": drive_url,
            "imported_at": int(time.time()),
            "chapters": chapters,
        })
        vol.commit()
        print(f"[import_book] Xong: {len(chapters)} chuong, {full_len} ky tu.")
        return {
            "book_id": book_id,
            "title": title,
            "chapters": [
                {"id": c["id"], "title": c["title"], "chars": len(c["text"])}
                for c in chapters
            ],
        }

    @web_app.post("/import_novel")
    def import_novel(payload: dict):
        """Nhap truyen web: cao thu 1 chuong de lay ten truyen."""
        import hashlib

        url = ((payload or {}).get("url") or "").strip()
        if not url:
            return Response(content='{"error": "no url"}', status_code=400,
                            media_type="application/json")
        data = crawl_chapter(url)
        book_id = "n" + hashlib.md5(data["story_title"].encode()).hexdigest()[:10]
        return {
            "book_id": book_id,
            "title": data["story_title"],
            "sample_chapter": data["chapter_title"],
        }

    @web_app.post("/enqueue")
    def enqueue(payload: dict):
        """App day chuong can gen. Moi item: {book_id, chapter_id, title, url?, engine, voice?}.
        position: 'back' (mac dinh) hoac 'front' (uu tien cao nhat)."""
        items = (payload or {}).get("items", [])
        position = (payload or {}).get("position", "back")
        if not items:
            return Response(content='{"error": "no items"}', status_code=400,
                            media_type="application/json")
        queue = _load_json(QUEUE_PATH, [])
        index = _load_json(INDEX_PATH, {})
        have = {(it.get("book_id"), it.get("chapter_id")) for it in queue}
        new_items = []
        for it in items:
            book_id = it.get("book_id")
            chapter_id = it.get("chapter_id")
            if not book_id or not chapter_id:
                continue
            if (book_id, chapter_id) in have:
                continue
            engine = it.get("engine", "gemini")
            voice = it.get("voice") or (KOKORO_VOICE if engine == "kokoro" else GEMINI_VOICE)
            existing = index.get(f"{book_id}/{chapter_id}")
            if existing and existing.get("engine") == engine and existing.get("voice") == voice:
                continue
            new_items.append({
                "book_id": book_id,
                "chapter_id": chapter_id,
                "title": it.get("title", ""),
                "url": it.get("url", ""),
                "text": it.get("text", ""),
                "engine": engine,
                "voice": voice,
            })
            have.add((book_id, chapter_id))
        if position == "front":
            queue = new_items + queue
        else:
            queue = queue + new_items
        _save_json(QUEUE_PATH, queue)
        vol.commit()
        return {"added": len(new_items), "pending": len(queue)}

    @web_app.post("/trigger")
    def trigger(payload: dict):
        """Gen ngay khong cho 3h sang: spawn batch nen."""
        n = (payload or {}).get("max_chapters", MAX_GEMINI_PER_RUN)
        try:
            n = max(1, min(int(n), 30))
        except Exception:
            n = MAX_GEMINI_PER_RUN
        batch_nightly.spawn(n)
        return {"triggered": True, "max_chapters": n}

    @web_app.get("/index")
    def get_index(book_id: str = ""):
        index = _load_json(INDEX_PATH, {})
        if book_id:
            chapters = {k.split("/", 1)[1]: v for k, v in index.items()
                        if k.startswith(book_id + "/")}
        else:
            chapters = index
        return {"chapters": chapters}

    @web_app.post("/remove_book")
    def remove_book(payload: dict):
        book_id = ((payload or {}).get("book_id") or "").strip()
        if not book_id:
            return Response(content='{"error": "no book_id"}', status_code=400,
                            media_type="application/json")
        queue = _load_json(QUEUE_PATH, [])
        index = _load_json(INDEX_PATH, {})
        before_q = len(queue)
        queue = [it for it in queue if it.get("book_id") != book_id]
        removed_q = before_q - len(queue)

        svc = drive_service()
        removed_files = 0
        for key in [k for k in list(index.keys()) if k.startswith(book_id + "/")]:
            fid = (index.get(key) or {}).get("drive_file_id")
            if fid:
                try:
                    svc.files().delete(fileId=fid).execute()
                    removed_files += 1
                except Exception:
                    pass
            del index[key]

        # Xoa text sach da luu trong Volume
        import os

        bp = _book_path(book_id)
        if os.path.exists(bp):
            try:
                os.remove(bp)
            except Exception:
                pass

        _save_json(QUEUE_PATH, queue)
        _save_json(INDEX_PATH, index)
        vol.commit()
        return {"removed_from_queue": removed_q, "removed_files": removed_files}

    return web_app
