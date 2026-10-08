import os
import sys
import asyncio
import soundfile as sf
import edge_tts
from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX
import kokoro_vietnamese.core as c

sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = os.path.join(os.path.dirname(__file__), "audio_samples")
os.makedirs(OUT_DIR, exist_ok=True)

SAMPLE_TEXT = "Chào bạn, đây là bản đọc thử nghiệm trên ứng dụng Sách Nói AudioVerse. Bạn hãy lắng nghe ngữ điệu và độ truyền cảm để chọn ra giọng đọc ưng ý nhất nhé."

async def generate_edge(voice_name, filename):
    communicate = edge_tts.Communicate(SAMPLE_TEXT, voice_name)
    await communicate.save(filename)

def main():
    print("=" * 60)
    print("🎙️ ĐANG TẠO FILE NGHE THỬ CHO TẤT CẢ 16 GIỌNG ĐỌC AI")
    print("=" * 60)

    # 1. 14 Giọng Kokoro Vietnamese
    for voice_id, info in c.VOICES.items():
        label = info.get('label', voice_id)
        out_path = os.path.join(OUT_DIR, f"kokoro_{voice_id}.wav")
        if not os.path.exists(out_path):
            print(f"[Kokoro] Đang tạo: {voice_id} ({label})...")
            try:
                model = KokoroVietnameseONNX(voice=voice_id, device='cpu')
                audio, _ = model.synthesize(SAMPLE_TEXT, speed=1.0)
                sf.write(out_path, audio, 24000)
                print(f" -> Xong {voice_id} ({os.path.getsize(out_path):,} bytes)")
            except Exception as e:
                print(f" -> Lỗi {voice_id}: {e}")
        else:
            print(f"[Kokoro] Đã có sẵn: {voice_id}")

    # 2. 2 Giọng Edge Neural
    edge_voices = [
        ("vi-VN-HoaiMyNeural", "Hoài My (Nữ Microsoft)", "edge_hoai_my.mp3"),
        ("vi-VN-NamMinhNeural", "Nam Minh (Nam Microsoft)", "edge_nam_minh.mp3")
    ]
    for voice_id, label, filename in edge_voices:
        out_path = os.path.join(OUT_DIR, filename)
        if not os.path.exists(out_path):
            print(f"[Edge] Đang tạo: {label}...")
            try:
                asyncio.run(generate_edge(voice_id, out_path))
                print(f" -> Xong {label} ({os.path.getsize(out_path):,} bytes)")
            except Exception as e:
                print(f" -> Lỗi {label}: {e}")
        else:
            print(f"[Edge] Đã có sẵn: {label}")

    print("=" * 60)
    print(f"✅ Hoàn tất! Tất cả file nghe thử đã được lưu tại: {OUT_DIR}")
    print("=" * 60)

if __name__ == "__main__":
    main()
