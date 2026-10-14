#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch uploader: đẩy các chương đã stream xong (full_chapter.mp3) lên Google Drive.

Quét data/stream_cache/{book}/{chap}/:
  - manifest.json có is_complete=true
  - full_chapter.mp3 tồn tại
  - chưa upload (manifest chưa có drive_file_id)

Upload lên folder "AudioVerse" trên Drive, public read, cập nhật data/index.json.

Credentials qua env var (không hardcode):
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

Chạy:  python3 batch_upload_drive.py [--dry-run]
"""

import io
import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
CACHE_DIR = DATA_DIR / "stream_cache"
INDEX_PATH = DATA_DIR / "index.json"
DRIVE_FOLDER_NAME = "AudioVerse"

DRY_RUN = "--dry-run" in sys.argv


def get_drive_service():
    """Tạo Drive API client từ env var."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        print("Thiếu env var: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN")
        sys.exit(1)

    creds = Credentials(
        None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
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


def upload_mp3(svc, folder_id: str, filename: str, mp3_bytes: bytes) -> str:
    from googleapiclient.http import MediaIoBaseUpload
    media = MediaIoBaseUpload(io.BytesIO(mp3_bytes), mimetype="audio/mpeg", resumable=True)
    meta = {"name": filename, "parents": [folder_id], "mimeType": "audio/mpeg"}
    file_id = svc.files().create(body=meta, media_body=media, fields="id").execute()["id"]
    # Public read
    svc.permissions().create(
        fileId=file_id, body={"type": "anyone", "role": "reader"}
    ).execute()
    return file_id


def find_completed_chapters():
    """Tìm các chương đã stream xong nhưng chưa upload Drive."""
    results = []
    if not CACHE_DIR.exists():
        return results
    for book_dir in CACHE_DIR.iterdir():
        if not book_dir.is_dir():
            continue
        for chap_dir in book_dir.iterdir():
            if not chap_dir.is_dir():
                continue
            manifest_path = chap_dir / "manifest.json"
            full_mp3 = chap_dir / "full_chapter.mp3"
            if not manifest_path.exists() or not full_mp3.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not manifest.get("is_complete"):
                continue
            if manifest.get("drive_file_id"):
                continue  # đã upload rồi
            results.append({
                "book_id": book_dir.name,
                "chapter_id": chap_dir.name,
                "full_mp3": full_mp3,
                "manifest_path": manifest_path,
                "manifest": manifest,
            })
    return results


def main():
    chapters = find_completed_chapters()
    if not chapters:
        print("Không có chương nào cần upload.")
        return

    print(f"Tìm thấy {len(chapters)} chương cần upload lên Drive.")
    if DRY_RUN:
        for c in chapters:
            size_kb = c["full_mp3"].stat().st_size // 1024
            print(f"  [dry-run] {c['book_id']}/{c['chapter_id']} ({size_kb} KB)")
        return

    svc = get_drive_service()
    folder_id = ensure_drive_folder(svc)
    print(f"Drive folder ID: {folder_id}")

    # Load index hiện tại
    index_data = {}
    if INDEX_PATH.exists():
        try:
            index_data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    done = 0
    for c in chapters:
        book_id = c["book_id"]
        chapter_id = c["chapter_id"]
        key = f"{book_id}/{chapter_id}"
        filename = f"{book_id}__{chapter_id}.mp3"
        try:
            mp3_bytes = c["full_mp3"].read_bytes()
            if len(mp3_bytes) < 1024:
                print(f"  Bỏ qua {key}: file quá nhỏ ({len(mp3_bytes)} bytes)")
                continue
            file_id = upload_mp3(svc, folder_id, filename, mp3_bytes)
            print(f"  ✓ {key} -> {file_id} ({len(mp3_bytes)//1024} KB)")

            # Cập nhật index
            index_data[key] = {
                "drive_file_id": file_id,
                "download_url": f"https://drive.google.com/uc?export=download&id={file_id}",
                "engine": "kokoro",
                "voice": "duc_an",
                "book_id": book_id,
                "chapter_id": chapter_id,
            }
            # Đánh dấu manifest đã upload
            manifest = c["manifest"]
            manifest["drive_file_id"] = file_id
            c["manifest_path"].write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            done += 1
        except Exception as e:
            print(f"  ✗ {key} lỗi: {e}")

    # Lưu index
    INDEX_PATH.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Hoàn thành: {done}/{len(chapters)} chương đã lên Drive.")


if __name__ == "__main__":
    main()
