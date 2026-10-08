import asyncio
import hashlib
import os
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import edge_tts

PORT = 3000
CACHE_DIR = os.path.join(os.path.dirname(__file__), "audio_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

class TTSHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default console logging that can fail on Windows encodings
        pass

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/tts":
                query = urllib.parse.parse_qs(parsed.query)
                text = query.get("text", [""])[0]
                voice = query.get("voice", ["vi-VN-HoaiMyNeural"])[0]

                if not text:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Missing text parameter")
                    return

                # MD5 cache
                cache_key = hashlib.md5(f"{text}_{voice}".encode("utf-8")).hexdigest()
                cache_path = os.path.join(CACHE_DIR, f"{cache_key}.mp3")

                if not os.path.exists(cache_path):
                    asyncio.run(self.generate_audio(text, voice, cache_path))

                if os.path.exists(cache_path):
                    with open(cache_path, "rb") as f:
                        data = f.read()

                    self.send_response(200)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self.send_response(500)
                    self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            try:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
            except:
                pass

    async def generate_audio(self, text, voice, output_file):
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_file)

def run():
    server_address = ("0.0.0.0", PORT)
    httpd = HTTPServer(server_address, TTSHandler)
    httpd.serve_forever()

if __name__ == "__main__":
    run()
