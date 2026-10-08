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
            if parsed.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status":"ok","engine":"kokoro+edge","voices":["kokoro_storyvert","kokoro_diem_trinh","kokoro_hung_thinh","vi-VN-HoaiMyNeural","vi-VN-NamMinhNeural"]}')
                return

            if parsed.path == "/tts":
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
