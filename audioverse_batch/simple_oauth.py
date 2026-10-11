import os
import urllib.request
import urllib.parse
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "YOUR_GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "YOUR_GOOGLE_CLIENT_SECRET")
REDIRECT_URI = "http://localhost:8080/"

captured_code = None

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global captured_code
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if "code" in qs:
            captured_code = qs["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<h1>Thanh cong! Ban co the dong cua so nay.</h1>")
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No code received")

def get_token():
    auth_url = (
        "https://accounts.google.com/o/oauth2/auth?"
        + urllib.parse.urlencode({
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.file",
            "access_type": "offline",
            "prompt": "consent"
        })
    )
    print("AUTH_URL:", auth_url, flush=True)

    server = HTTPServer(("localhost", 8080), OAuthHandler)
    print("Waiting for callback on localhost:8080...", flush=True)
    while not captured_code:
        server.handle_request()

    print("Got code:", captured_code[:15], "...", flush=True)

    # Exchange code for tokens
    post_data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": captured_code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI
    }).encode("utf-8")

    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=post_data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        tokens = json.loads(resp.read().decode("utf-8"))

    refresh_token = tokens.get("refresh_token")
    print("REFRESH_TOKEN:", refresh_token, flush=True)
    with open("refresh_token.txt", "w", encoding="utf-8") as f:
        f.write(refresh_token)

if __name__ == "__main__":
    get_token()
