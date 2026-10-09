---
title: AudioVerse TTS Server
emoji: 🔊
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Server đọc sách nói tiếng Việt (Kokoro + Edge-TTS + crawler)
---

# AudioVerse TTS Server

Server Python cho app AudioVerse:

- `GET /health` — kiểm tra server
- `GET /tts.wav?text=...&voice=kokoro_storyvert` — Kokoro (14 giọng Việt, WAV 24kHz)
- `GET /tts.mp3?text=...&voice=vi-VN-HoaiMyNeural` — Edge-TTS (MP3)
- `POST /tts` — JSON `{text, voice}`
- `GET /api/crawl?url=...` — cào nội dung chương truyện

Lần request TTS đầu tiên sẽ tải model Kokoro (~300MB, một lần duy nhất).
