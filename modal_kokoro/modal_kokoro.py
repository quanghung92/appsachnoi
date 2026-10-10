"""AudioVerse - Kokoro TTS Server trên Modal.com
Serverless TTS tiếng Việt tự động khởi động khi có request, tự ngủ khi không dùng.

Lệnh sử dụng:
  1. Tải model vào Volume (1 lần duy nhất):
     modal run modal_kokoro.py::download_model

  2. Deploy lên Modal:
     modal deploy modal_kokoro.py

  3. Test nhanh trên mây:
     modal run modal_kokoro.py::test_tts
"""

from __future__ import annotations

import io
import os
import re
import urllib.parse
from pathlib import Path

import modal

# ---------------------------------------------------------------------------
# Cấu hình Modal App & Storage
# ---------------------------------------------------------------------------
APP_NAME = "audioverse-kokoro"
VOLUME_NAME = "audioverse-kokoro-data"
MODEL_DIR = "/models"

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Docker Image chứa đầy đủ thư viện cho ONNX runtime & Kokoro TTS tiếng Việt
kokoro_image = (
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
    )
    .add_local_python_source("kokoro_vietnamese")
)

# ---------------------------------------------------------------------------
# 1. Hàm tải Model và Voicepacks vào Modal Volume (chạy 1 lần duy nhất)
# ---------------------------------------------------------------------------
@app.function(
    image=kokoro_image,
    volumes={MODEL_DIR: volume},
    timeout=1200,
)
def download_model():
    """Tải toàn bộ model ONNX, config và 14 voicepack vào Volume vĩnh viễn."""
    from huggingface_hub import hf_hub_download
    from kokoro_vietnamese.core import (
        DEFAULT_CONFIG_FILE,
        DEFAULT_HF_REPO_ID,
        DEFAULT_ONNX_FILE,
        VOICES,
    )

    print("============================================================")
    print(f"[Download] Bat dau tai model tu Hugging Face: {DEFAULT_HF_REPO_ID}")
    print(f"[Download] Luu tru tai Modal Volume: {MODEL_DIR}")
    print("============================================================")

    os.makedirs(MODEL_DIR, exist_ok=True)

    # 1. Tải file ONNX model (~300MB)
    print("1/3 -> Dang tai ONNX model (kokoro_vi.onnx)...")
    onnx_file = hf_hub_download(
        repo_id=DEFAULT_HF_REPO_ID,
        filename=DEFAULT_ONNX_FILE,
        local_dir=MODEL_DIR,
    )
    print(f"    [OK] Xong: {onnx_file}")

    # 2. Tải config.json
    print("2/3 -> Dang tai config.json...")
    cfg_file = hf_hub_download(
        repo_id=DEFAULT_HF_REPO_ID,
        filename=DEFAULT_CONFIG_FILE,
        local_dir=MODEL_DIR,
    )
    print(f"    [OK] Xong: {cfg_file}")

    # 3. Tải tất cả 14 voicepacks
    print(f"3/3 -> Dang tai {len(VOICES)} voicepacks...")
    for idx, (voice_id, voice_info) in enumerate(VOICES.items(), 1):
        vp_filename = voice_info["filename"]
        print(f"    [{idx:02d}/{len(VOICES):02d}] Tai voice: {voice_id} ({vp_filename})...")
        hf_hub_download(
            repo_id=DEFAULT_HF_REPO_ID,
            filename=vp_filename,
            local_dir=MODEL_DIR,
        )

    # Commit lưu vĩnh viễn vào Volume
    volume.commit()
    print("============================================================")
    print("[SUCCESS] TAI HOAN TAT! Tat ca du lieu da luu vao Modal Volume.")
    print("Bay gio ban co the chay: modal deploy modal_kokoro.py")
    print("============================================================")


# ---------------------------------------------------------------------------
# 2. Hàm test nhanh bằng CLI: modal run modal_kokoro.py::test_tts
# ---------------------------------------------------------------------------
@app.function(
    image=kokoro_image,
    volumes={MODEL_DIR: volume},
    cpu=2.0,
    memory=2048,
    timeout=120,
)
def test_tts(text: str = "Chào bạn, AudioVerse đang chạy Kokoro TTS trên nền tảng Modal serverless."):
    """Chạy thử 1 câu và kiểm tra tốc độ."""
    import time
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX

    print(f"[Test] Văn bản: {text}")
    t0 = time.time()
    onnx_p = os.path.join(MODEL_DIR, "kokoro_vi.onnx")
    cfg_p = os.path.join(MODEL_DIR, "config.json")
    vp_p = os.path.join(MODEL_DIR, "voicepacks/storyvert.pt")

    tts = KokoroVietnameseONNX(
        voice="storyvert",
        onnx_path=onnx_p if os.path.exists(onnx_p) else None,
        config_path=cfg_p if os.path.exists(cfg_p) else None,
        voicepack_path=vp_p if os.path.exists(vp_p) else None,
        device="cpu",
    )
    print(f"[Test] Load model mất: {time.time() - t0:.2f}s")

    t1 = time.time()
    audio_data, phonemes = tts.synthesize(text, speed=1.0)
    dur = len(audio_data) / 24000.0
    print(f"[Test] Tổng hợp audio {dur:.2f}s mất: {time.time() - t1:.2f}s")
    print(f"[Test] RTF: {(time.time() - t1) / dur:.2f}x (càng nhỏ càng nhanh)")
    return f"OK: {dur:.2f}s audio"


# ---------------------------------------------------------------------------
# 3. Web Service FastAPI (Endpoint phục vụ App di động AudioVerse)
# ---------------------------------------------------------------------------
@app.function(
    image=kokoro_image,
    volumes={MODEL_DIR: volume},
    cpu=4.0,  # 4 vCPUs giúp ONNX inference nhanh gấp đôi, giảm thiểu tối đa độ trễ
    memory=2048,  # Đổi thành 4096 nếu cần thêm RAM khi xử lý văn bản dài
    scaledown_window=300,  # Giữ ấm container 5 phút để các câu sau nghe mượt
    max_containers=1,  # CHỈ CHẠY 1 CONTAINER: Tiết kiệm tối đa $30 credit và tái sử dụng model đã warm trong RAM
)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, HTTPException, Query, Response
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import soundfile as sf
    from kokoro_vietnamese.core import DEFAULT_VOICE, SAMPLE_RATE, VOICES
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX

    web_app = FastAPI(
        title="AudioVerse Kokoro TTS API",
        description="Serverless Kokoro Vietnamese TTS API chạy trên Modal",
        version="1.0.0",
    )

    # Bật CORS để điện thoại không bị lỗi chặn Origin
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Bộ nhớ cache model trong container (chỉ nạp 1 lần khi container ấm)
    loaded_models: dict[str, KokoroVietnameseONNX] = {}

    def get_model(voice_id: str) -> KokoroVietnameseONNX:
        # Chuẩn hóa voice name: "kokoro_storyvert" -> "storyvert"
        clean = voice_id.lower().replace("kokoro_", "").strip()
        if clean not in VOICES:
            clean = DEFAULT_VOICE

        if clean not in loaded_models:
            print(f"[Modal] Nạp model cho giọng: {clean}...")
            onnx_p = os.path.join(MODEL_DIR, "kokoro_vi.onnx")
            cfg_p = os.path.join(MODEL_DIR, "config.json")
            vp_filename = VOICES[clean]["filename"]
            vp_p = os.path.join(MODEL_DIR, vp_filename)

            loaded_models[clean] = KokoroVietnameseONNX(
                voice=clean,
                onnx_path=onnx_p if os.path.exists(onnx_p) else None,
                config_path=cfg_p if os.path.exists(cfg_p) else None,
                voicepack_path=vp_p if os.path.exists(vp_p) else None,
                device="cpu",
            )
        return loaded_models[clean]

    # --- Crawler module bóc tách chương truyện (Wetruyen, TruyenFull, TangThuVien...) ---
    def crawl_chapter_content(url: str) -> dict:
        from bs4 import BeautifulSoup
        import urllib.request
        import urllib.parse
        import re

        raw_url = url.strip()
        slug_match = re.search(r'(?:truyenfull\.[a-z]+|dtruyen\.com|wetruyen\.com|metruyencv\.com)/([a-zA-Z0-9_-]+)', raw_url)
        slug = slug_match.group(1) if slug_match else ""

        urls_to_try = []
        if ("truyenfull" in raw_url or "wetruyen" in raw_url) and slug:
            urls_to_try.append(f"https://wetruyen.com/{slug}/chuong-1.html")
        urls_to_try.append(raw_url)

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"
        }

        html = None
        final_url = raw_url
        last_err = None
        for u in urls_to_try:
            try:
                req = urllib.request.Request(u, headers=headers)
                with urllib.request.urlopen(req, timeout=18) as resp:
                    html = resp.read().decode("utf-8", errors="ignore")
                    final_url = resp.geturl()
                    if html:
                        break
            except Exception as e:
                last_err = e
                continue

        if not html:
            raise RuntimeError(f"Không thể tải trang truyện: {last_err or raw_url}")

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "iframe", "ins"]):
            tag.decompose()

        # Nếu link đưa vào là trang chủ của truyện, tìm link chương 1
        is_chap = bool(re.search(r'chuong[-_]\d+|chap[-_]\d+', final_url))
        if not is_chap:
            chap1_link = None
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if re.search(r'chuong[-_]1(?:\.html|/|$)', href, re.I):
                    chap1_link = href
                    break
            if chap1_link:
                if not chap1_link.startswith("http"):
                    chap1_link = urllib.parse.urljoin(final_url, chap1_link)
                try:
                    req = urllib.request.Request(chap1_link, headers=headers)
                    with urllib.request.urlopen(req, timeout=18) as resp:
                        html = resp.read().decode("utf-8", errors="ignore")
                        final_url = resp.geturl()
                        soup = BeautifulSoup(html, "html.parser")
                        for tag in soup(["script", "style", "iframe", "ins"]):
                            tag.decompose()
                except Exception:
                    pass

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

        content = ""
        for sel in [
            "#chapter-c", ".chapter-c", "#chapter-content",
            ".chapter-content", "#chr-content", ".box-chap",
            "#vungdoc", ".entry-content", "article"
        ]:
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

        # Dọn dẹp nội dung rác quảng cáo
        junk = ["truyenfull", "tangthuvien", "dtruyen", "quảng cáo", "bình luận", "vip", "donate"]
        clean_lines = []
        for line in content.split("\n"):
            line = line.strip()
            if not line:
                continue
            if any(j in line.lower() for j in junk) and len(line) < 120:
                continue
            clean_lines.append(line)
        cleaned_content = "\n".join(clean_lines)

        if not cleaned_content or len(cleaned_content) < 80:
            raise RuntimeError("Không bóc tách được nội dung chương")

        if not story_title:
            story_title = soup.title.get_text(strip=True)[:80] if soup.title else "Truyện web"
        if not chapter_title:
            m = urllib.parse.urlparse(final_url).path.rstrip("/").split("/")[-1]
            chapter_title = m.replace("-", " ").title() or "Chương mới"

        chapter_num = 0
        mnum = re.search(r"chuong-(\d+)", final_url)
        if mnum:
            chapter_num = int(mnum.group(1))

        return {
            "status": "ok",
            "url": final_url,
            "story_title": story_title,
            "chapter_title": chapter_title,
            "chapter_number": chapter_num,
            "author": "",
            "content": cleaned_content,
            "content_length": len(cleaned_content),
            "prev_url": prev_url,
            "next_url": next_url,
        }

    # --- Endpoints ---
    @web_app.get("/")
    @web_app.get("/health")
    def health_check():
        """Health check endpoint cho AudioVerse test kết nối."""
        return {
            "status": "ok",
            "engine": "Kokoro (Modal Serverless)",
            "message": "AudioVerse Kokoro TTS Server is ready!",
            "voices": [f"kokoro_{k}" for k in VOICES.keys()],
            "default_voice": "kokoro_storyvert",
        }

    @web_app.get("/api/crawl")
    def crawl_endpoint(url: str = Query(..., description="URL chương truyện web")):
        try:
            return crawl_chapter_content(url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    def generate_wav(text: str, voice: str, speed: float) -> bytes:
        if not text or not text.strip():
            raise ValueError("Văn bản rỗng")
        model = get_model(voice)
        audio_data, _ = model.synthesize(text.strip(), speed=speed)
        buf = io.BytesIO()
        sf.write(buf, audio_data, SAMPLE_RATE, format="WAV")
        return buf.getvalue()

    @web_app.get("/tts")
    @web_app.get("/tts.wav")
    @web_app.get("/tts.mp3")
    def tts_get(
        text: str = Query(..., description="Văn bản cần đọc"),
        voice: str = Query("kokoro_storyvert", description="Giọng đọc"),
        speed: float = Query(1.0, description="Tốc độ"),
    ):
        try:
            data = generate_wav(text, voice, speed)
            return Response(
                content=data,
                media_type="audio/wav",
                headers={
                    "Content-Type": "audio/wav",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*",
                },
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    class TTSRequestBody(BaseModel):
        text: str
        voice: str = "kokoro_storyvert"
        speed: float = 1.0

    @web_app.post("/tts")
    def tts_post(body: TTSRequestBody):
        try:
            data = generate_wav(body.text, body.voice, body.speed)
            return Response(
                content=data,
                media_type="audio/wav",
                headers={
                    "Content-Type": "audio/wav",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*",
                },
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return web_app
