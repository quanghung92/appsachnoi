import asyncio
import hashlib
import os
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import shutil
from pathlib import Path
import soundfile as sf
import edge_tts

sys.stdout.reconfigure(encoding='utf-8')

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    BeautifulSoup = None
    HAS_BS4 = False

try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

PORT = int(os.environ.get("PORT", 3000))
CACHE_DIR = os.path.join(os.path.dirname(__file__), "audio_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

def resolve_hf_symlinks():
    """Tự động xử lý symlink cache HuggingFace trên Windows cho ONNX Runtime."""
    try:
        hub_dir = Path.home() / ".cache" / "huggingface" / "hub"
        if not hub_dir.exists():
            return
        for repo_dir in hub_dir.iterdir():
            if not repo_dir.is_dir():
                continue
            name = repo_dir.name.lower()
            if "vieneu" in name or "moss" in name:
                snapshots = repo_dir / "snapshots"
                if snapshots.exists():
                    for f in list(snapshots.rglob("*")):
                        if f.is_symlink():
                            target = f.resolve()
                            f.unlink()
                            shutil.copyfile(target, f)
    except Exception as e:
        print(f"[Server] Symlink check notice: {e}")

# Mapping giọng VieNeu
VIENEU_VOICE_MAP = {
    "vieneu_truc_ly": "Trúc Ly",
    "vieneu_thien_minh": "Thiện Minh",
    "vieneu_hai_dang": "Hải Đăng",
    "vieneu_mai_anh": "Mai Anh",
    "vieneu_thuy_dung": "Thùy Dung",
    "vieneu_thai_son": "Thái Sơn",
    "vieneu_ngoc_tran": "Ngọc Trân",
    "vieneu_quang_son": "Quang Sơn",
    "vieneu_adam_bua": "Adam bựa",
    "vieneu_adam": "Adam",
    "vieneu_ngoc_huyen": "Ngọc Huyền",
    "vieneu_thien_tam_duc": "Thiền Tâm Đức",
    "vieneu_minh_duc": "Minh Đức",
    "vieneu_pham_tuyen": "Phạm Tuyên",
    "vieneu_xuan_vinh": "Xuân Vĩnh",
    "vieneu_thanh_binh": "Thanh Bình",
    "vieneu_ngoc_linh": "Ngọc Linh",
    "vieneu_doan_trang": "Đoan Trang",
    "vieneu_thuc_doan": "Thục Đoan",
    "vieneu_minh_triet": "Minh Triết",
    "vieneu_my_duyen": "Mỹ Duyên",
    "vieneu_quynh_anh": "Quỳnh Anh",
    "vieneu_duc_tri": "Đức Trí",
    "vieneu_kim_thanh": "Kim Thanh",
    "vieneu_quoc_tuan": "Quốc Tuấn",
    # Ánh xạ dự phòng nếu thiết bị còn lưu ID cũ từ Kokoro
    "kokoro_storyvert": "Trúc Ly",
    "kokoro_diem_trinh": "Mai Anh",
    "kokoro_hung_thinh": "Thiện Minh",
}

# Khởi tạo mô hình VieNeu-TTS
vieneu_instance = None

def get_vieneu_model():
    global vieneu_instance
    if vieneu_instance is None:
        print("[Server] Đang nạp mô hình VieNeu-TTS 48kHz...")
        resolve_hf_symlinks()
        from vieneu import Vieneu
        try:
            vieneu_instance = Vieneu()
        except Exception as e:
            print(f"[Server] Thử khắc phục symlink ONNX và nạp lại: {e}")
            resolve_hf_symlinks()
            vieneu_instance = Vieneu()
        print("[Server] Đã nạp thành công VieNeu-TTS!")
    return vieneu_instance

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), "audio_samples")
AUDITION_HTML = os.path.join(os.path.dirname(__file__), "audition.html")

# ---------------------------------------------------------------------------
# Web novel crawler (PLAN B1): boc tach noi dung chuong that tu TruyenFull...
# ---------------------------------------------------------------------------
CRAWL_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")

JUNK_PATTERNS = [
    "truyenfull", "tangthuvien", "dtruyen", "metruyenchu",
    "quảng cáo", "bình luận", "mời bạn", "vip", "donate",
]


def _clean_text(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        low = line.lower()
        if any(p in low for p in JUNK_PATTERNS) and len(line) < 120:
            continue
        lines.append(line)
    return "\n".join(lines)


def _fetch_html(target_url: str):
    import urllib.request
    headers = {"User-Agent": CRAWL_UA, "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"}
    req = urllib.request.Request(target_url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore"), resp.geturl()

def crawl_chapter(url: str) -> dict:
    """Crawl 1 chuong truyen, tra ve dict. Ho tro TruyenFull, Wetruyen, Dtruyen, MetruyenCV..."""
    if not HAS_BS4:
        raise RuntimeError("Thieu thu vien beautifulsoup4. Chay: pip install beautifulsoup4")
    import re
    import urllib.parse

    raw_url = url.strip()
    slug_match = re.search(r'(?:truyenfull\.[a-z]+|dtruyen\.com|wetruyen\.com|metruyencv\.com)/([a-zA-Z0-9_-]+)', raw_url)
    slug = slug_match.group(1) if slug_match else ""

    urls_to_try = []
    if ("truyenfull" in raw_url or "wetruyen" in raw_url) and slug:
        urls_to_try.append(f"https://wetruyen.com/{slug}/chuong-1.html")
    urls_to_try.append(raw_url)

    html = None
    final_url = raw_url
    last_err = None
    for u in urls_to_try:
        try:
            html, final_url = _fetch_html(u)
            if html:
                break
        except Exception as e:
            last_err = e
            continue

    if not html:
        raise RuntimeError(f"Khong the tai trang truyen: {last_err or raw_url}")

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "iframe", "ins"]):
        tag.decompose()

    # Neu link dua vao la trang chu cua truyen (chua co chuong-X), tu tim link chuong 1
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
                html, final_url = _fetch_html(chap1_link)
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

    # Prev & Next links
    prev_url = ""
    next_url = ""
    for a in soup.select("a#prev_chap, a.prev-chap, a.btn-prev"):
        h = a.get("href") or ""
        if h.startswith("http"):
            prev_url = h
    for a in soup.select("a#next_chap, a.next-chap, a.btn-next"):
        h = a.get("href") or ""
        if h.startswith("http"):
            next_url = h

    content = _clean_text(content)
    # Loai bo quang cao google ads
    content = re.sub(r'\(adsbygoogle\s*=\s*window\.adsbygoogle\s*\|\|\s*\[\]\)\.push\(\{\}\);?', '', content)

    if not content or len(content) < 100:
        raise RuntimeError("Khong boc tach duoc noi dung chuong (site co the chan bot)")

    if not story_title:
        story_title = (soup.title.get_text(strip=True)[:80] if soup.title else "Truyen web")
    if not chapter_title:
        m = urllib.parse.urlparse(final_url).path.rstrip("/").split("/")[-1]
        chapter_title = m.replace("-", " ").title() or "Chuong moi"

    chapter_number = 0
    mnum = re.search(r"chuong[-_](\d+)", final_url)
    if mnum:
        chapter_number = int(mnum.group(1))

    return {
        "status": "ok",
        "url": final_url,
        "story_title": story_title,
        "chapter_title": chapter_title,
        "chapter_number": chapter_number,
        "author": "",
        "content": content,
        "content_length": len(content),
        "prev_url": prev_url,
        "next_url": next_url,
    }


class TTSHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            print(f"[Server] GET {parsed.path}", flush=True)

            if parsed.path in ["/", "/test", "/audition"]:
                if os.path.exists(AUDITION_HTML):
                    with open(AUDITION_HTML, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(data)
                    return

            if parsed.path.startswith("/samples/"):
                filename = urllib.parse.unquote(parsed.path.replace("/samples/", ""))
                sample_file = os.path.join(SAMPLES_DIR, filename)
                if os.path.exists(sample_file):
                    content_type = "audio/wav" if filename.endswith(".wav") else "audio/mpeg"
                    with open(sample_file, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    self.wfile.write(data)
                    return
                else:
                    self.send_response(404)
                    self.end_headers()
                    return

            if parsed.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status":"ok","engine":"vieneu+edge","voices":["vieneu_truc_ly","vieneu_thien_minh","vieneu_hai_dang","vieneu_mai_anh","vieneu_thuy_dung","vieneu_thai_son","vieneu_ngoc_tran","vieneu_quang_son","vi-VN-HoaiMyNeural","vi-VN-NamMinhNeural"]}')
                return

            if parsed.path == "/api/crawl":
                import json as _json
                query = urllib.parse.parse_qs(parsed.query)
                url = query.get("url", [""])[0]
                try:
                    result = crawl_chapter(url)
                    body = _json.dumps(result, ensure_ascii=False).encode("utf-8")
                    self.send_response(200)
                except Exception as e:
                    body = _json.dumps({"status": "error", "message": str(e)},
                                       ensure_ascii=False).encode("utf-8")
                    self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return

            if parsed.path in ["/tts", "/tts.wav", "/tts.mp3"]:
                query = urllib.parse.parse_qs(parsed.query)
                text = query.get("text", [""])[0]
                voice = query.get("voice", ["vieneu_truc_ly"])[0]
                speed_str = query.get("speed", ["1.0"])[0]

                try:
                    speed = float(speed_str.replace('%', '').replace('+', ''))
                    if speed > 10:  # e.g. +0%
                        speed = 1.0
                except:
                    speed = 1.0

                self.process_tts(text, voice, speed)
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            try:
                print(f"[Server] Error: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
            except:
                pass

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/api/save-selected-voices":
                content_length = int(self.headers.get('Content-Length', 0))
                post_body = self.rfile.read(content_length).decode('utf-8')
                import json
                data = json.loads(post_body)
                voices = data.get("voices", [])
                selected_path = os.path.join(os.path.dirname(__file__), "selected_voices.json")
                with open(selected_path, "w", encoding="utf-8") as f:
                    json.dump(voices, f, ensure_ascii=False, indent=2)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                return

            if parsed.path == "/tts":
                content_length = int(self.headers.get('Content-Length', 0))
                post_body = self.rfile.read(content_length).decode('utf-8')
                import json
                data = json.loads(post_body)
                text = data.get("text", "")
                voice = data.get("voice", "vieneu_truc_ly")
                speed = float(data.get("speed", 1.0))
                self.process_tts(text, voice, speed)
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode("utf-8"))

    def process_tts(self, text, voice, speed):
        if not text:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing text parameter")
            return

        is_edge = voice.startswith("vi-VN-")
        ext = "mp3" if is_edge else "wav"
        content_type = "audio/mpeg" if is_edge else "audio/wav"

        cache_key = hashlib.md5(f"{text}_{voice}_{speed}".encode("utf-8")).hexdigest()
        cache_path = os.path.join(CACHE_DIR, f"{cache_key}.{ext}")

        if not os.path.exists(cache_path):
            if is_edge:
                print(f"[Server] Synthesizing Edge-TTS ({voice}): {text[:40]}...")
                asyncio.run(self.generate_edge_audio(text, voice, cache_path))
            else:
                vieneu_voice_name = VIENEU_VOICE_MAP.get(voice, voice)
                print(f"[Server] Synthesizing VieNeu-TTS 48kHz ({vieneu_voice_name}): {text[:40]}...")
                model = get_vieneu_model()
                audio_data = model.infer(text, voice=vieneu_voice_name)
                if speed != 1.0 and HAS_LIBROSA:
                    audio_data = librosa.effects.time_stretch(audio_data, rate=speed)
                sf.write(cache_path, audio_data, 48000)

        if os.path.exists(cache_path):
            with open(cache_path, "rb") as f:
                data = f.read()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(500)
            self.end_headers()

    async def generate_edge_audio(self, text, voice, output_file):
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_file)

def run():
    server_address = ("0.0.0.0", PORT)
    httpd = HTTPServer(server_address, TTSHandler)
    try:
        import socket
        _s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _s.connect(("8.8.8.8", 80))
        lan_ip = _s.getsockname()[0]
        _s.close()
    except Exception:
        lan_ip = "?"
    print("======================================================")
    print(f"🎧 AudioVerse Dual TTS Server (VieNeu-TTS 48kHz + Edge-TTS)")
    print(f"👉 Local Endpoint: http://localhost:{PORT}/tts")
    print(f"👉 Wi-Fi Endpoint: http://{lan_ip}:{PORT}/tts")
    print("======================================================")
    # Tải trước model để lượt đọc đầu tiên không bị delay
    try:
        get_vieneu_model()
    except Exception as e:
        print(f"[Server] Cảnh báo nạp trước model: {e}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
