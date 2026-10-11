"""
AudioVerse batch TTS pipeline (chay tren Modal) — "nha may" audio.

Khong stream realtime nua. Moi dem 3h sang (gio VN), cron:
  1. Doc hang doi chuong can gen tu Volume.
  2. Tu lay noi dung: cao URL truyen / tra text sach trong Volume.
  3. TRUYEN (web novel) -> VieNeu v3 Turbo (giong Mai Anh).
     SACH (PDF)        -> VieNeu v3 Turbo (giong Thien Minh).
  4. Tron nhac nen (truyen: guzheng / sach: piano xoay vong) -> MP3.
  5. Upload len thu muc AudioVerse tren Google Drive.
  6. Cap nhat index.json.

App vao THANG Drive lay MP3 nghe (stream hoac tai ve may tuy cau hinh),
khong qua Modal nua.

Setup (1 lan, tren PC):
  1. Chay drive_oauth.py -> modal secret create google-drive-oauth ...
     (xem HUONG_DAN_BATCH.md)
  2. Chay download_vieneu_model 1 lan de tai model (~541MB) len Volume
  3. Copy nhac nen (novel_bg.mp3, book_bg1.mp3, book_bg2.mp3) len Volume /data/music/
  4. modal deploy modal_batch_vieneu.py

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
vieneu_vol = modal.Volume.from_name("audioverse-vieneu-data", create_if_missing=True)
DATA_DIR = "/data"
MODEL_DIR = "/models"
QUEUE_PATH = "/data/queue.json"
INDEX_PATH = "/data/index.json"
BOOKS_PATH = "/data/books.json"  # registry book_id -> {title, type} cho truyen web
BOOKS_DIR = "/data/books"
MUSIC_DIR = "/data/music"  # nhac nen: novel_bg.mp3, book_bg1.mp3, book_bg2.mp3

# --- Cau hinh ---
VIENEU_VOICE_NOVEL = "Mai Anh"    # giong truyen (Nguyen chon)
VIENEU_VOICE_BOOK = "Thien Minh"  # giong sach (Nguyen chon)
MAX_VIENEU_PER_RUN = 200  # ~3-5 phut/chuong -> 200 chuong ~10-16h; chia nhieu run neu can
MAX_CHARS_PER_REQUEST = 20000
DRIVE_FOLDER_NAME = "AudioVerse"
CRON_SCHEDULE = "0 20 * * *"  # 3h sang gio VN = 20h UTC
MUSIC_VOLUME = 0.12  # nhac nen 12% so voi loi doc

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi>=0.109.0",
        "uvicorn>=0.27.0",
        "onnxruntime>=1.17.0",
        "soundfile>=0.12.1",
        "huggingface_hub>=0.20.0",
        "beautifulsoup4>=4.12.0",
        "numpy>=1.24.0,<2.0.0",
        "requests",
        "google-api-python-client",
        "google-auth",
        "imageio-ffmpeg",
        "pypdf",
        "vieneu>=3.8.0",
    )
)

_SECRETS = [
    modal.Secret.from_name("google-drive-oauth"),
]
_VOLUMES = {DATA_DIR: vol, MODEL_DIR: vieneu_vol}


class QuotaExhausted(Exception):
    pass


# ---------------------------------------------------------------- JSON helpers

def _load_json(path, default):
    import json
    import os

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

def _fresh_load(path, default):
    """Doc du lieu moi nhat tu Volume (container API song lau, khong reload se thay du lieu cu)."""
    try:
        vol.reload()
    except Exception:
        pass
    return _load_json(path, default)



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


# ---------------------------------------------------------------- VieNeu v3 Turbo

_vieneu_model = None


def _patch_vieneu_codec():
    """Workaround: HF blob-cache symlink lam ONNX Runtime loi external-data.
    Dung thu muc codec phang tren Volume."""
    import os
    from pathlib import Path

    try:
        from vieneu._v3_turbo_engine import onnx_runtime_lite as _ort_lite

        codec_dir = f"{MODEL_DIR}/vieneu-codec"
        if not os.path.isdir(codec_dir):
            return
        _orig_fetch = _ort_lite.OnnxV3LiteEngine._fetch

        def _patched_fetch(repo, files, subfolder):
            if "MOSS-Audio-Tokenizer" in str(repo):
                return Path(codec_dir)
            return _orig_fetch(repo, files, subfolder)

        _ort_lite.OnnxV3LiteEngine._fetch = staticmethod(_patched_fetch)
    except Exception as e:
        print(f"[vieneu] Khong patch duoc codec: {e}")


def get_vieneu():
    """Load model VieNeu v3 Turbo 1 lan (lazy). Tra ve Vieneu instance."""
    global _vieneu_model
    if _vieneu_model is None:
        import os

        _patch_vieneu_codec()
        from vieneu import Vieneu

        onnx_dir = f"{MODEL_DIR}/vieneu-fp32"
        if not os.path.isdir(onnx_dir):
            raise RuntimeError(
                f"Chua co model VieNeu tren Volume ({onnx_dir}). "
                "Chay download_vieneu_model 1 lan truoc."
            )
        print("[vieneu] Nap model...")
        _vieneu_model = Vieneu(onnx_dir=onnx_dir)
        print("[vieneu] Xong.")
    return _vieneu_model


def vieneu_synthesize(text: str, voice: str) -> bytes:
    """Doc text bang VieNeu. Tra ve WAV 48kHz (chuyen ve 24kHz cho dong nhat)."""
    import io

    import numpy as np
    import soundfile as sf

    model = get_vieneu()
    audio = model.infer(text.strip(), voice=voice)
    audio = np.asarray(audio, dtype=np.float32)
    # Resample 48k -> 24k
    if len(audio) > 1:
        audio_24k = audio[::2]  # downsample don gian (48k->24k)
    else:
        audio_24k = audio
    buf = io.BytesIO()
    sf.write(buf, audio_24k, 24000, format="WAV")
    return buf.getvalue()


@app.function(image=image, volumes=_VOLUMES, timeout=3600, cpu=2.0, memory=4096)
def download_vieneu_model():
    """Tai model VieNeu v3 Turbo (~541MB) len Volume. Chay 1 lan duy nhat."""
    import os
    import shutil

    from huggingface_hub import snapshot_download

    import json

    # 1. Backbone fp32
    backbone_dir = f"{MODEL_DIR}/vieneu-fp32"
    cfg_path = os.path.join(backbone_dir, "config.json")
    needs_download = True
    if os.path.isfile(cfg_path) and os.path.isfile(os.path.join(backbone_dir, "vieneu_prefill.onnx")):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                c_data = json.load(f)
            if c_data.get("local_num_hidden_layers") == 1:
                needs_download = False
        except Exception:
            needs_download = True

    if needs_download:
        print("[download] Tai backbone pnnbao-ump/VieNeu-TTS-v3-Turbo...")
        tmp = snapshot_download("pnnbao-ump/VieNeu-TTS-v3-Turbo")
        os.makedirs(backbone_dir, exist_ok=True)
        # Sao chep cac file onnx graph & config tu thu muc onnx_update
        onnx_sub = os.path.join(tmp, "onnx_update")
        if os.path.isdir(onnx_sub):
            for f in os.listdir(onnx_sub):
                src = os.path.join(onnx_sub, f)
                if os.path.isfile(src):
                    shutil.copy2(src, os.path.join(backbone_dir, f))
        for f in ["denoiser.onnx", "speaker_encoder.onnx"]:
            src = os.path.join(tmp, f)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(backbone_dir, f))
        print(f"[download] Xong backbone -> {backbone_dir}")
    else:
        print("[download] Backbone hop le, bo qua.")

    # 2. Codec MOSS (flat, khong dung HF cache)
    codec_dir = f"{MODEL_DIR}/vieneu-codec"
    if not os.path.isdir(codec_dir) or not os.path.isfile(os.path.join(codec_dir, "moss_audio_tokenizer_decode_full.onnx")):
        print("[download] Tai codec MOSS-Audio-Tokenizer...")
        tmp = snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
        os.makedirs(codec_dir, exist_ok=True)
        for f in os.listdir(tmp):
            src = os.path.join(tmp, f)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(codec_dir, f))
        print(f"[download] Xong codec -> {codec_dir}")
    else:
        print("[download] Codec da co, bo qua.")

    vieneu_vol.commit()

    print("[test] Kiem tra nap model va doc thu...")
    test_wav = vieneu_synthesize("Xin chào, đây là AudioVerse.", "Trúc Ly")
    print(f"[test] Thanh cong! Do dai am thanh test: {len(test_wav)} bytes.")

    return {"backbone": backbone_dir, "codec": codec_dir}


# ---------------------------------------------------------------- Nhac nen

def _mix_bg_music(wav_bytes: bytes, music_path: str, volume: float = MUSIC_VOLUME) -> bytes:
    """Tron nhac nen duoi loi doc. wav_bytes: WAV 24kHz mono."""
    import io
    import subprocess
    import tempfile
    import os

    import numpy as np
    import soundfile as sf

    if not os.path.exists(music_path):
        print(f"[music] Khong thay {music_path}, bo qua nhac nen.")
        return wav_bytes

    narr, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if narr.ndim > 1:
        narr = narr.mean(axis=1)

    # MP3 -> WAV 24kHz mono
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", music_path,
             "-ac", "1", "-ar", "24000", "-f", "wav", tmp_wav],
            check=True,
        )
        music, _ = sf.read(tmp_wav, dtype="float32")
    finally:
        if os.path.exists(tmp_wav):
            os.remove(tmp_wav)

    n = len(narr)
    if len(music) < n:
        reps = int(np.ceil(n / len(music)))
        music = np.tile(music, reps)[:n]
    else:
        music = music[:n]

    # Fade 3s de loop muot
    f = min(int(3 * 24000), n // 4)
    if f > 0:
        music[:f] *= np.linspace(0, 1, f)
        music[-f:] *= np.linspace(1, 0, f)

    peak = np.max(np.abs(music))
    if peak > 0:
        music = music / peak * 0.9
    music = music * volume

    mixed = narr + music
    pm = np.max(np.abs(mixed))
    if pm > 0.99:
        mixed = mixed / pm * 0.99

    buf = io.BytesIO()
    sf.write(buf, mixed.astype(np.float32), 24000, format="WAV")
    return buf.getvalue()


def _pick_music(book_type: str, chapter_num: int) -> str | None:
    """Chon nhac nen: truyen -> guzheng; sach -> piano xoay vong."""
    import os

    if book_type == "novel":
        p = f"{MUSIC_DIR}/novel_bg.mp3"
        return p if os.path.exists(p) else None
    else:
        cands = [f"{MUSIC_DIR}/book_bg1.mp3", f"{MUSIC_DIR}/book_bg2.mp3"]
        cands = [c for c in cands if os.path.exists(c)]
        if not cands:
            return None
        return cands[(chapter_num - 1) % len(cands)]


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
    urls_to_try = [raw_url]
    # Fallback: neu raw_url la truyenfull ma fetch that bai, thu wetruyen CUNG SO chuong
    # (khong bao gio dung chuong-1 cho chuong khac - bug cu da gay ra 30 chuong giong nhau)
    if "truyenfull" in raw_url and slug:
        m = re.search(r"chuong-(\d+)", raw_url)
        if m:
            urls_to_try.append(f"https://wetruyen.com/{slug}/chuong-{m.group(1)}.html")

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


def ensure_book_folder(svc, parent_id: str, book_id: str, book_title: str) -> str:
    """Tim hoac tao subfolder theo ten sach/truyen trong thu muc AudioVerse."""
    name = (book_title or book_id).strip().replace("'", "")[:80] or book_id
    q = (f"name='{name}' and '{parent_id}' in parents and "
         f"mimeType='application/vnd.google-apps.folder' and trashed=false")
    res = svc.files().list(q=q, fields="files(id)", pageSize=1).execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": name, "parents": [parent_id],
            "mimeType": "application/vnd.google-apps.folder"}
    return svc.files().create(body=meta, fields="id").execute()["id"]


def _book_title(book_id: str) -> str:
    """Lay ten sach/truyen de dat ten thu muc: tu book JSON (sach) hoac registry (truyen)."""
    try:
        book = _load_json(_book_path(book_id), None)
        if book and book.get("title"):
            return book["title"]
        books = _load_json(BOOKS_PATH, {})
        return (books.get(book_id) or {}).get("title", "")
    except Exception:
        return ""


def drive_upload_mp3(svc, folder_id: str, filename: str, mp3_bytes: bytes) -> str:
    import io

    from googleapiclient.http import MediaIoBaseUpload

    media = MediaIoBaseUpload(io.BytesIO(mp3_bytes), mimetype="audio/mpeg", resumable=True)
    meta = {"name": filename, "parents": [folder_id], "mimeType": "audio/mpeg"}
    file_id = svc.files().create(body=meta, media_body=media, fields="id").execute()["id"]
    # Cho phep "anyone with the link" tai truc tiep:
    # app tai MP3 bang link uc?export=download ma KHONG dang nhap Google,
    # neu de private thi Drive tra ve trang sign-in thay vi file.
    svc.permissions().create(
        fileId=file_id, body={"type": "anyone", "role": "reader"}
    ).execute()
    return file_id


# ---------------------------------------------------------------- Batch core

def _split_long_text(text: str):
    if len(text) <= MAX_CHARS_PER_REQUEST:
        return [text]
    parts, cur = [], ""
    for chunk in text.replace("\r", "").split("\n\n"):
        if len(cur) + len(chunk) + 2 > MAX_CHARS_PER_REQUEST and cur:
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


def _book_type(book_id: str) -> str:
    """Doan loai sach/truyen tu registry. Mac dinh 'novel' neu co url, 'book' neu khong."""
    books = _load_json(BOOKS_PATH, {})
    info = books.get(book_id, {})
    t = info.get("type", "")
    if t in ("novel", "book"):
        return t
    # Fallback: neu book_id co trong books.json cua novel import
    return "book" if info.get("drive_url") else "novel"


def _save_queue_safe(remaining: list, completed_keys: set):
    """Luu queue an toan: reload file truoc, chi xoa item run nay da xong.
    Khong bao gio hoi sinh item user da xoa tay (fix bug 11/10)."""
    current = _load_json(QUEUE_PATH, [])
    kept = [it for it in current
            if f"{it.get('book_id')}/{it.get('chapter_id')}" not in completed_keys]
    kept_keys = {f"{it.get('book_id')}/{it.get('chapter_id')}" for it in kept}
    for it in remaining:
        k = f"{it.get('book_id')}/{it.get('chapter_id')}"
        if k not in kept_keys and k not in completed_keys:
            kept.append(it)
    _save_json(QUEUE_PATH, kept)
    vol.commit()


def _run_batch(max_items: int = MAX_VIENEU_PER_RUN):
    import os
    import re

    queue = _load_json(QUEUE_PATH, [])
    index = _load_json(INDEX_PATH, {})
    if not queue:
        print("[batch] Hang doi trong.")
        return {"done": 0}

    svc = drive_service()
    folder_id = ensure_drive_folder(svc)

    done, skipped = 0, 0
    remaining = list(queue)
    completed_keys = set()

    for item in list(queue):
        # Cancel flag
        if os.path.exists("/data/cancel.flag"):
            print("[batch] Gap cancel.flag - dung batch.")
            try:
                os.remove("/data/cancel.flag")
            except Exception:
                pass
            _save_queue_safe(remaining, completed_keys)
            break
        if done >= max_items:
            break
        key = f"{item['book_id']}/{item['chapter_id']}"
        btype = _book_type(item["book_id"])
        _OLD_VOICES = {"duc_an", "diem_trinh", "zubenelgenubi"}
        _v = (item.get("voice") or "").strip()
        if not _v or _v.lower().replace("kokoro_", "") in _OLD_VOICES or _v.lower().startswith("kokoro_"):
            voice = VIENEU_VOICE_NOVEL if btype == "novel" else VIENEU_VOICE_BOOK
        else:
            voice = _v

        # Da co audio dung giong -> bo qua
        existing = index.get(key)
        if existing and existing.get("voice") == voice and existing.get("engine") == "vieneu":
            remaining.remove(item)
            completed_keys.add(key)
            skipped += 1
            continue

        print(f"[batch] Gen {key} [vieneu/{voice}]...")
        try:
            text = resolve_item_text(item)
        except Exception as e:
            print(f"[batch] Khong lay duoc text {key}: {e}")
            remaining.remove(item)
            completed_keys.add(key)
            continue

        try:
            # VieNeu: chuong dai cat nho
            parts = _split_long_text(text)
            import io as _io

            import numpy as _np
            import soundfile as _sf

            wavs = []
            for p in parts:
                wavs.append(vieneu_synthesize(p, voice))
            arrays = []
            for w in wavs:
                data, _ = _sf.read(_io.BytesIO(w))
                arrays.append(data)
            buf = _io.BytesIO()
            _sf.write(buf, _np.concatenate(arrays), 24000, format="WAV")
            wav = buf.getvalue()
        except Exception as e:
            print(f"[batch] Loi synth {key}: {e}")
            remaining.remove(item)
            completed_keys.add(key)
            continue

        # Tron nhac nen (tu dong)
        try:
            ch_num = int(re.sub(r"\D", "", item["chapter_id"]) or "1")
        except Exception:
            ch_num = 1
        music_path = _pick_music(btype, ch_num)
        if music_path:
            try:
                wav = _mix_bg_music(wav, music_path)
                print(f"[batch] Da tron nhac nen: {music_path.split('/')[-1]}")
            except Exception as e:
                print(f"[batch] Loi tron nhac {key}: {e} (bo qua nhac)")

        try:
            mp3 = wav_to_mp3(wav)
        except Exception as e:
            print(f"[batch] Loi convert MP3 {key}: {e}")
            remaining.remove(item)
            completed_keys.add(key)
            continue

        # Xoa file Drive cu neu gen lai (doi giong)
        if existing and existing.get("drive_file_id"):
            try:
                svc.files().delete(fileId=existing["drive_file_id"]).execute()
            except Exception:
                pass

        fname = f"{item['chapter_id']}.mp3"
        book_folder = ensure_book_folder(
            svc, folder_id, item["book_id"], _book_title(item["book_id"]))
        try:
            file_id = drive_upload_mp3(svc, book_folder, fname, mp3)
        except Exception as e:
            print(f"[batch] Loi upload {key}: {e}")
            continue

        index[key] = {
            "drive_file_id": file_id,
            "download_url": f"https://drive.google.com/uc?export=download&id={file_id}",
            "engine": "vieneu",
            "voice": voice,
            "title": item.get("title", ""),
            "book_id": item["book_id"],
            "chapter_id": item["chapter_id"],
        }
        remaining.remove(item)
        completed_keys.add(key)
        done += 1
        print(f"[batch] Xong {key} ({len(mp3) // 1024} KB).")
        _save_queue_safe(remaining, completed_keys)
        _save_json(INDEX_PATH, index)
        vol.commit()

    print(f"[batch] Hoan tat: {done} moi, {skipped} da co, con {len(remaining)} cho.")
    return {"done": done, "skipped": skipped, "remaining": len(remaining)}


@app.function(
    image=image,
    volumes=_VOLUMES,
    secrets=_SECRETS,
    cpu=2.0,
    memory=4096,
    schedule=modal.Cron(CRON_SCHEDULE),
    timeout=14400,
)
def batch_nightly(max_items: int = MAX_VIENEU_PER_RUN):
    return _run_batch(max_items=max_items)


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
        queue = _fresh_load(QUEUE_PATH, [])
        index = _fresh_load(INDEX_PATH, {})
        return {
            "pending": len(queue),
            "done": len(index),
            "vieneu_voice_novel": VIENEU_VOICE_NOVEL,
            "vieneu_voice_book": VIENEU_VOICE_BOOK,
        }

    @web_app.get("/queue")
    def get_queue(book_id: str = ""):
        """App xem hang doi (thu tu = do uu tien). Co the loc theo sach."""
        queue = _fresh_load(QUEUE_PATH, [])
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
        queue = _fresh_load(QUEUE_PATH, [])
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
        queue = _fresh_load(QUEUE_PATH, [])
        before = len(queue)
        queue = [it for it in queue
                 if not (it.get("book_id") == book_id and it.get("chapter_id") == chapter_id)]
        _save_json(QUEUE_PATH, queue)
        vol.commit()
        return {"removed": before - len(queue)}

    @web_app.post("/cancel")
    def cancel_batch():
        """Dung batch dang chay (graceful - xong chuong hien tai roi dung)."""
        import os

        with open("/data/cancel.flag", "w") as f:
            f.write("cancel")
        vol.commit()
        return {"cancel_requested": True}

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
        # Luu registry book_id -> ten truyen de dat ten thu muc Drive
        try:
            _books = _load_json(BOOKS_PATH, {})
        except Exception:
            _books = {}
        _books[book_id] = {"title": data["story_title"], "type": "novel"}
        _save_json(BOOKS_PATH, _books)
        vol.commit()
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
        queue = _fresh_load(QUEUE_PATH, [])
        index = _fresh_load(INDEX_PATH, {})
        have = {(it.get("book_id"), it.get("chapter_id")) for it in queue}
        new_items = []
        for it in items:
            book_id = it.get("book_id")
            chapter_id = it.get("chapter_id")
            if not book_id or not chapter_id:
                continue
            if (book_id, chapter_id) in have:
                continue
            engine = it.get("engine", "vieneu")
            _v = (it.get("voice") or "").strip()
            _OLD = {"duc_an", "diem_trinh", "zubenelgenubi"}
            if not _v or _v.lower().replace("kokoro_", "") in _OLD or _v.lower().startswith("kokoro_"):
                voice = VIENEU_VOICE_NOVEL
            else:
                voice = _v
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
        n = (payload or {}).get("max_chapters", MAX_VIENEU_PER_RUN)
        try:
            n = max(1, min(int(n), 30))
        except Exception:
            n = MAX_VIENEU_PER_RUN
        batch_nightly.spawn(n)
        return {"triggered": True, "max_chapters": n}

    @web_app.get("/index")
    def get_index(book_id: str = ""):
        index = _fresh_load(INDEX_PATH, {})
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
        queue = _fresh_load(QUEUE_PATH, [])
        index = _fresh_load(INDEX_PATH, {})
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
