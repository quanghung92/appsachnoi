# Hugging Face Spaces (Docker) - free tier, không cần thẻ
FROM python:3.11-slim

# espeak-ng: cần cho kokoro_vietnamese (G2P phonemizer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng libsndfile1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY server.py .

# HF Spaces tự set biến PORT (mặc định 7860)
EXPOSE 7860
CMD ["sh", "-c", "python server.py"]
