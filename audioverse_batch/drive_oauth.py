import sys
import os
import webbrowser

sys.stdout.reconfigure(encoding='utf-8')
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

def custom_open(url):
    print("AUTH_URL:", url, flush=True)
    with open("auth_url.txt", "w", encoding="utf-8") as f:
        f.write(url)
    os.system(f'start "" "{url}"')
    return True

webbrowser.open = custom_open

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "YOUR_GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "YOUR_GOOGLE_CLIENT_SECRET")

def main():
    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        SCOPES,
    )
    print("Khoi dong OAuth server...", flush=True)
    creds = flow.run_local_server(port=8080, open_browser=True)
    print("\nSUCCESS_REFRESH_TOKEN", flush=True)
    print(creds.refresh_token, flush=True)
    with open("refresh_token.txt", "w", encoding="utf-8") as f:
        f.write(creds.refresh_token)

if __name__ == "__main__":
    main()
