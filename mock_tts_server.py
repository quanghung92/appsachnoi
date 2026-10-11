#!/usr/bin/env python3
"""Mock TTS server for testing the AudioVerse app without the Kokoro model.
Implements the same API as server.py:
  GET /health
  GET /tts.wav?text=&voice=&speed=   -> returns a real Kokoro sample WAV
  GET /tts.mp3?text=&voice=&speed=   -> returns a real Edge sample MP3
"""
import os
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, "/home/hatch/workspace/pip_libs")

PORT = 3000
BASE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(BASE, "audio_samples")

# Reuse the real crawler code from server.py (without importing soundfile/edge_tts)
def _load_crawler():
    src = open(os.path.join(BASE, "server.py"), encoding="utf-8").read()
    start = src.index("try:\n    from bs4 import BeautifulSoup")
    end = src.index("class TTSHandler")
    ns = {"os": os, "urllib": urllib, "__file__": os.path.join(BASE, "server.py")}
    exec(src[start:end], ns)
    return ns["crawl_chapter"]

try:
    crawl_chapter = _load_crawler()
    print("[Mock] crawler loaded")
except Exception as e:
    crawl_chapter = None
    print(f"[Mock] crawler unavailable: {e}")

VOICE_SAMPLE = {
    "kokoro_storyvert": "kokoro_storyvert.wav",
    "kokoro_diem_trinh": "kokoro_diem_trinh.wav",
    "kokoro_hung_thinh": "kokoro_hung_thinh.wav",
    "kokoro_duc_an": "kokoro_duc_an.wav",
    "kokoro_duc_duy": "kokoro_duc_duy.wav",
    "kokoro_mai_linh": "kokoro_mai_linh.wav",
    "kokoro_mai_loan": "kokoro_mai_loan.wav",
    "kokoro_manh_dung": "kokoro_manh_dung.wav",
    "kokoro_my_yen": "kokoro_my_yen.wav",
    "kokoro_ngoc_huyen": "kokoro_ngoc_huyen.wav",
    "kokoro_phat_tai": "kokoro_phat_tai.wav",
    "kokoro_thanh_dat": "kokoro_thanh_dat.wav",
    "kokoro_thuc_trinh": "kokoro_thuc_trinh.wav",
    "kokoro_tuan_ngoc": "kokoro_tuan_ngoc.wav",
    "vi-VN-HoaiMyNeural": "edge_hoai_my.mp3",
    "vi-VN-NamMinhNeural": "edge_nam_minh.mp3",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[Mock] {self.command} {self.path}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            body = b'{"status":"ok","engine":"mock-kokoro+edge"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/crawl":
            import json as _json
            query = urllib.parse.parse_qs(parsed.query)
            url = query.get("url", [""])[0]
            try:
                if crawl_chapter is None:
                    raise RuntimeError("crawler unavailable")
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
        if parsed.path in ("/tts.wav", "/tts.mp3"):
            query = urllib.parse.parse_qs(parsed.query)
            voice = query.get("voice", ["kokoro_storyvert"])[0]
            fname = VOICE_SAMPLE.get(voice, "kokoro_storyvert.wav")
            fpath = os.path.join(SAMPLES, fname)
            if os.path.exists(fpath):
                with open(fpath, "rb") as f:
                    data = f.read()
                ctype = "audio/wav" if fname.endswith(".wav") else "audio/mpeg"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
                return
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    print(f"[Mock] TTS server on http://0.0.0.0:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
