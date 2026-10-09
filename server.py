import asyncio
import hashlib
import os
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import soundfile as sf
import edge_tts
from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX

sys.stdout.reconfigure(encoding='utf-8')

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    BeautifulSoup = None
    HAS_BS4 = False

PORT = 3000
CACHE_DIR = os.path.join(os.path.dirname(__file__), "audio_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Cache initialized Kokoro voice models in memory for fast synthesis
kokoro_instances = {}

def get_kokoro_model(voice_id: str):
    if voice_id not in kokoro_instances:
        print(f"[Server] Loading Kokoro model for voice: {voice_id}...")
        kokoro_instances[voice_id] = KokoroVietnameseONNX(voice=voice_id, device="cpu")
    return kokoro_instances[voice_id]

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


def crawl_chapter(url: str) -> dict:
    """Crawl 1 chuong truyen, tra ve dict. Raise Exception khi loi."""
    if not HAS_BS4:
        raise RuntimeError("Thieu thu vien beautifulsoup4. Chay: pip install beautifulsoup4")
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": CRAWL_UA})
    with urllib.request.urlopen(req, timeout=25) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    final_url = resp.geturl()

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "iframe", "ins"]):
        tag.decompose()

    host = urllib.parse.urlparse(final_url).netloc.lower()

    story_title = ""
    chapter_title = ""
    content = ""
    prev_url = ""
    next_url = ""

    def pick_text(selectors):
        for sel in selectors:
            el = soup.select_one(sel)
            if el:
                t = el.get_text(" ", strip=True)
                if len(t) > 3:
                    return t
        return ""

    if "truyenfull" in host:
        story_title = pick_text(["h1", ".truyen-title"])
        chapter_title = pick_text([".chapter-title", "h2"])
        el = soup.select_one("#chapter-c")
        if el:
            content = el.get_text("\n", strip=True)
        for a in soup.select("a#prev_chap"):
            href = a.get("href") or ""
            if href.startswith("http"):
                prev_url = href
        for a in soup.select("a#next_chap"):
            href = a.get("href") or ""
            if href.startswith("http"):
                next_url = href
    else:
        # Site khac: thu cac selector pho bien
        story_title = pick_text(["h1", ".truyen-title", ".story-title"])
        chapter_title = pick_text([".chapter-title", "h2", ".chr-title"])
        for sel in ["#chapter-c", ".chapter-c", "#chapter-content",
                    ".chapter-content", "#chr-content", ".box-chap",
                    "#vungdoc", ".entry-content", "article"]:
            el = soup.select_one(sel)
            if el:
                t = el.get_text("\n", strip=True)
                if len(t) > 200:
                    content = t
                    break
        if not content:
            # Fallback: lay khoi van ban lon nhat trong body
            best, best_len = "", 0
            for div in soup.find_all(["div", "article"]):
                t = div.get_text("\n", strip=True)
                if len(t) > best_len and len(t) > 300:
                    best, best_len = t, len(t)
            content = best

    content = _clean_text(content)
    if not content or len(content) < 100:
        raise RuntimeError("Khong boc tach duoc noi dung chuong (site co the chan bot)")

    if not story_title:
        story_title = (soup.title.get_text(strip=True)[:80] if soup.title else "Truyện web")
    if not chapter_title:
        m = urllib.parse.urlparse(final_url).path.rstrip("/").split("/")[-1]
        chapter_title = m.replace("-", " ").title() or "Chương mới"

    chapter_number = 0
    mnum = __import__("re").search(r"chuong-(\d+)", final_url)
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
                self.wfile.write(b'{"status":"ok","engine":"kokoro+edge","voices":["kokoro_storyvert","kokoro_diem_trinh","kokoro_hung_thinh","vi-VN-HoaiMyNeural","vi-VN-NamMinhNeural"]}')
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
                voice = query.get("voice", ["kokoro_storyvert"])[0]
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
                voice = data.get("voice", "kokoro_storyvert")
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

        is_kokoro = voice.startswith("kokoro_")
        ext = "wav" if is_kokoro else "mp3"
        content_type = "audio/wav" if is_kokoro else "audio/mpeg"

        cache_key = hashlib.md5(f"{text}_{voice}_{speed}".encode("utf-8")).hexdigest()
        cache_path = os.path.join(CACHE_DIR, f"{cache_key}.{ext}")

        if not os.path.exists(cache_path):
            if is_kokoro:
                kokoro_voice_name = voice.replace("kokoro_", "")
                print(f"[Server] Synthesizing Kokoro ({kokoro_voice_name}): {text[:40]}...")
                model = get_kokoro_model(kokoro_voice_name)
                audio_data, _ = model.synthesize(text, speed=speed)
                sf.write(cache_path, audio_data, 24000)
            else:
                print(f"[Server] Synthesizing Edge-TTS ({voice}): {text[:40]}...")
                asyncio.run(self.generate_edge_audio(text, voice, cache_path))

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
    print("======================================================")
    print(f"🎧 AudioVerse Dual TTS Server (Kokoro + Edge-TTS)")
    print(f"👉 Local Endpoint: http://localhost:{PORT}/tts")
    print(f"👉 Wi-Fi Endpoint: http://192.168.110.172:{PORT}/tts")
    print("======================================================")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
