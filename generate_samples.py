import os
import sys
import asyncio
import soundfile as sf
import edge_tts
from vieneu import Vieneu

sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = os.path.join(os.path.dirname(__file__), "audio_samples")
os.makedirs(OUT_DIR, exist_ok=True)

SAMPLE_TEXT = "Chào bạn, đây là bản đọc thử nghiệm trên ứng dụng Sách Nói AudioVerse. Bạn hãy lắng nghe ngữ điệu và độ truyền cảm để chọn ra giọng đọc ưng ý nhất nhé."

async def generate_edge(voice_name, filename):
    communicate = edge_tts.Communicate(SAMPLE_TEXT, voice_name)
    await communicate.save(filename)

def main():
    print("=" * 60)
    print("🎙️ ĐANG TẠO FILE NGHE THỬ CHO CÁC GIỌNG ĐỌC AI VIENEU-TTS & EDGE")
    print("=" * 60)

    vieneu = Vieneu()
    preset_voices = vieneu.list_preset_voices()

    # 1. Các giọng VieNeu-TTS
    for label, voice_id in preset_voices:
        # Chuẩn hóa tên file: ví dụ vieneu_truc_ly.wav
        safe_name = voice_id.lower().replace(" ", "_")
        out_path = os.path.join(OUT_DIR, f"vieneu_{safe_name}.wav")
        if not os.path.exists(out_path):
            print(f"[VieNeu] Đang tạo: {voice_id} ({label})...")
            try:
                audio = vieneu.infer(SAMPLE_TEXT, voice=voice_id)
                sf.write(out_path, audio, 48000)
                print(f" -> Xong {voice_id} ({os.path.getsize(out_path):,} bytes)")
            except Exception as e:
                print(f" -> Lỗi {voice_id}: {e}")
        else:
            print(f"[VieNeu] Đã có sẵn: {voice_id}")

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
