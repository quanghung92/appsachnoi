"""
Script Benchmark Kokoro Vietnamese tren Modal CPU.
Muc tieu:
  1. Do latency thuc te sinh am thanh cho cac kich thuoc chunk khac nhau (15 tu, 30 tu, 55 tu).
  2. Do Real-Time Factor (RTF = Inference Time / Audio Duration).
  3. Mo phong chuoi Pipeline stream (Chunk 0, Chunk 1, Chunk 2) de kiem tra tinh kha thi.

Chay bang lenh:
  cd audioverse_batch
  modal run benchmark_kokoro.py
"""

import time
import modal

app = modal.App("audioverse-kokoro-benchmark")
kokoro_vol = modal.Volume.from_name("audioverse-kokoro-data")

MODEL_DIR = "/models"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "onnxruntime>=1.17.0",
        "torch>=2.1.0",
        "soundfile>=0.12.1",
        "huggingface_hub>=0.20.0",
        "vig2p>=0.1.0",
        "numpy>=1.24.0,<2.0.0",
    )
    .add_local_python_source("kokoro_vietnamese")
)

# Cac doan van ban mau tu tieu thuyet thuc te
BENCHMARK_SAMPLES = [
    {
        "name": "Chunk Ngan (17 tu)",
        "text": "Đêm đã về khuya, gió rít từng cơn lạnh buốt qua khe cửa sổ gỗ cũ kỹ.",
    },
    {
        "name": "Chunk Vua (33 tu - Co chunk chuan de xuat)",
        "text": "Hàn Lập ngẩng đầu nhìn lên đỉnh núi Thất Huyền Môn cao chót vót, trong lòng không khỏi dâng lên một cỗ cảm xúc bồi hồi khó tả sau bao năm xa cách quê hương bản quán.",
    },
    {
        "name": "Chunk Dai (56 tu)",
        "text": "Tiếng sấm rền vang từ phía chân trời xa xăm, từng luồng mây đen cuồn cuộn kéo đến phủ kín cả một vùng sơn cốc. Hắn khẽ hít một hơi thật sâu, vận chuyển linh lực trong cơ thể chảy xuôi theo kinh mạch, chuẩn bị đón nhận đợt lôi kiếp hung hiểm nhất trong đời tu tiên của mình.",
    },
]


@app.function(
    image=image,
    volumes={MODEL_DIR: kokoro_vol},
    cpu=2.0,  # 2 CPU cores tieu chuan tren Modal
    memory=2048,  # 2GB RAM
    timeout=300,
)
def run_benchmark():
    from kokoro_vietnamese.core import VOICES, phonemize
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX

    print("=" * 70)
    print("🚀 BẮT ĐẦU BENCHMARK KOKORO VIETNAMESE TRÊN MODAL CPU (2 Cores)")
    print("=" * 70)

    voice_id = "duc_an"
    print(f"\n[1/3] Đang nạp model Kokoro ONNX (Giọng: {voice_id})...")
    load_start = time.perf_counter()
    model = KokoroVietnameseONNX(
        voice=voice_id,
        onnx_path=f"{MODEL_DIR}/kokoro_vi.onnx",
        config_path=f"{MODEL_DIR}/config.json",
        voicepack_path=f"{MODEL_DIR}/{VOICES[voice_id]['filename']}",
        device="cpu",
    )
    load_time = time.perf_counter() - load_start
    print(f"✅ Nạp model thành công trong {load_time:.2f}s!")

    # Warmup
    print("\n[2/3] Chạy Warmup 1 câu ngắn để khởi động ONNX runtime cache...")
    warmup_text = "Xin chào các bạn."
    _ = model.synthesize(warmup_text, speed=1.0)
    print("✅ Warmup hoàn tất!")

    # Chạy đo đạc từng mẫu
    print("\n[3/3] ĐO ĐẠC CHI TIẾT TỪNG MẪU VĂN BẢN:")
    print("-" * 70)

    results = []
    for sample in BENCHMARK_SAMPLES:
        text = sample["text"]
        words = len(text.split())
        chars = len(text)

        # 1. Do thoi gian Phonemize (vig2p)
        t0 = time.perf_counter()
        phonemes = phonemize(text)
        t_phonemize = time.perf_counter() - t0

        # 2. Do thoi gian ONNX inference
        t1 = time.perf_counter()
        audio, _phonemes = model.synthesize(text, speed=1.0)
        t_total = time.perf_counter() - t0
        t_onnx = t_total - t_phonemize

        # 3. Tinh thoi luong audio sinh ra (giay)
        sample_rate = 24000
        audio_duration = len(audio) / sample_rate

        # 4. Tinh RTF (Real-Time Factor: < 1.0 la nhanh hon thoi gian thuc)
        rtf = t_total / audio_duration if audio_duration > 0 else 0
        speedup = audio_duration / t_total if t_total > 0 else 0

        res = {
            "name": sample["name"],
            "words": words,
            "chars": chars,
            "t_phonemize": t_phonemize,
            "t_onnx": t_onnx,
            "t_total": t_total,
            "audio_duration": audio_duration,
            "rtf": rtf,
            "speedup": speedup,
        }
        results.append(res)

        print(f"\n📌 MẪU: {sample['name']}")
        print(f"   Văn bản ({words} từ, {chars} ký tự): \"{text[:45]}...\"")
        print(f"   ⏱️ Thời gian Phonemize (vig2p) : {t_phonemize*1000:.1f} ms")
        print(f"   ⏱️ Thời gian ONNX Inference   : {t_onnx*1000:.1f} ms")
        print(f"   ⚡ TỔNG THỜI GIAN GEN (LATENCY): {t_total:.3f} giây")
        print(f"   🔊 Thời lượng Audio phát ra    : {audio_duration:.2f} giây")
        print(f"   📊 Real-Time Factor (RTF)      : {rtf:.3f} (Nhanh gấp {speedup:.2f}x lần thời gian nói)")

    # 4. Mo phong chuoi Pipeline Stream lien tuc (Chunk 0, Chunk 1, Chunk 2)
    print("\n" + "=" * 70)
    print("🔄 MÔ PHỎNG PIPELINE STREAM 3 CHUNKS LIÊN TIẾP (Khoảng 35 từ/chunk):")
    print("=" * 70)
    pipeline_chunks = [
        "Hàn Lập ngẩng đầu nhìn lên đỉnh núi Thất Huyền Môn cao chót vót trong màn sương mờ ảo.",
        "Tiếng lá thông xào xạc theo từng cơn gió lạnh thoảng qua bên tai khiến lòng hắn lắng lại.",
        "Hắn siết chặt bọc hành lý trên vai, hít một hơi thật sâu rồi cất bước đi lên bậc thang đá.",
    ]

    for i, chunk_text in enumerate(pipeline_chunks):
        c_start = time.perf_counter()
        c_audio, _ = model.synthesize(chunk_text, speed=1.0)
        c_gen_time = time.perf_counter() - c_start
        c_dur = len(c_audio) / 24000
        print(f"   Chunk {i}: Gen mất {c_gen_time:.2f}s | Audio đọc trong {c_dur:.2f}s | Dôi dư buffer: +{c_dur - c_gen_time:.2f}s")

    print("\n" + "=" * 70)
    print("📋 BẢNG KẾT LUẬN & ĐÁNH GIÁ KỸ THUẬT:")
    print("=" * 70)
    for r in results:
        status = "✅ ĐẠT (< 2s)" if r["t_total"] < 2.0 else "⚠️ CHẬM (> 2s)"
        safe_buffer = "✅ AN TOÀN (Gối đầu kịp)" if r["speedup"] >= 2.0 else "⚠️ NGUY HIỂM"
        print(f" - {r['name']}: {r['t_total']:.2f}s gen -> {r['audio_duration']:.2f}s audio | {status} | Buffer: {safe_buffer}")

    print("=" * 70)


@app.local_entrypoint()
def main():
    run_benchmark.remote()
