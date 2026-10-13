#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Benchmark Kokoro Vietnamese cho máy Ubuntu (Máy gen truyện).
Theo đặc tả BƯỚC 0:
  - Đo với các kích thước chunk: 15, 20, 35, 40, 60 từ.
  - Mỗi kích thước chạy 3 lần lấy trung bình.
  - Sử dụng giọng: duc_an.
  - Baseline so sánh: Modal CPU 2-core (RTF ~0.40).
"""

import os
import sys
import time
from pathlib import Path
import numpy as np

# Tự động thêm đường dẫn module kokoro_vietnamese
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
BATCH_DIR = PROJECT_ROOT / "audioverse_batch"

for p in [str(PROJECT_ROOT), str(BATCH_DIR), str(CURRENT_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX
    from kokoro_vietnamese.core import VOICES, phonemize, SAMPLE_RATE
except ImportError:
    try:
        from audioverse_batch.kokoro_vietnamese.onnx_cli import KokoroVietnameseONNX
        from audioverse_batch.kokoro_vietnamese.core import VOICES, phonemize, SAMPLE_RATE
    except ImportError as e:
        print(f"❌ Không tìm thấy module kokoro_vietnamese! Hãy kiểm tra đường dẫn. Lỗi: {e}")
        sys.exit(1)

# Các tập mẫu kiểm thử theo đúng số từ yêu cầu (15, 20, 35, 40, 60 từ)
BENCHMARK_CASES = [
    {
        "target_words": 15,
        "text": "Đêm đã về khuya, gió rít từng cơn lạnh buốt qua khe cửa sổ gỗ cũ kỹ.",
    },
    {
        "target_words": 20,
        "text": "Tiếng bước chân khe khẽ vang lên trên hành lang vắng lặng, bóng đêm bao trùm lấy toàn bộ căn nhà hoang phế.",
    },
    {
        "target_words": 35,
        "text": "Hàn Lập ngẩng đầu nhìn lên đỉnh núi Thất Huyền Môn cao chót vót, trong lòng không khỏi dâng lên một cỗ cảm xúc bồi hồi khó tả sau bao nhiêu năm bôn ba lưu lạc xa cách quê hương bản quán.",
    },
    {
        "target_words": 40,
        "text": "Mặt trời vừa ló dạng sau rặng tre làng, ánh ban mai rực rỡ chiếu rọi xuống dòng sông uốn lượn hiền hòa, từng đoàn thuyền chài tấp nập kéo nhau ra khơi bắt đầu một ngày lao động mới đầy hăng say và phấn khởi.",
    },
    {
        "target_words": 60,
        "text": "Tiếng sấm rền vang từ phía chân trời xa xăm, từng luồng mây đen cuồn cuộn kéo đến phủ kín cả một vùng sơn cốc rộng lớn. Hắn khẽ hít một hơi thật sâu, vận chuyển toàn bộ linh lực trong cơ thể chảy xuôi theo kinh mạch đan điền, tập trung cao độ chuẩn bị đón nhận đợt lôi kiếp hung hiểm và gian nan nhất đời mình.",
    },
]

# Baseline trên Modal CPU 2-core: RTF ~0.402
BASELINE_MODAL_RTF = 0.402


def find_model_paths():
    """Tìm kiếm file model onnx và voicepack trên máy local nếu có."""
    search_dirs = [
        Path.home() / "models",
        Path.home() / ".cache" / "kokoro",
        Path("/models"),
        PROJECT_ROOT / "models",
        BATCH_DIR / "models",
        CURRENT_DIR / "models",
    ]
    onnx_path = None
    config_path = None
    voicepack_path = None

    for d in search_dirs:
        if (d / "kokoro_vi.onnx").exists():
            onnx_path = d / "kokoro_vi.onnx"
            config_path = d / "config.json"
            vp = d / "voicepacks" / "duc_an.pt"
            if not vp.exists():
                vp = d / "duc_an.pt"
            if vp.exists():
                voicepack_path = vp
            break

    return onnx_path, config_path, voicepack_path


def main():
    voice_id = "duc_an"
    print("=" * 85)
    print(f"🚀 BENCHMARK KOKORO VIETNAMESE TRÊN MÁY UBUNTU (Giọng: {voice_id})")
    print("=" * 85)

    onnx_path, config_path, voicepack_path = find_model_paths()

    kwargs = {"voice": voice_id, "device": "cpu"}
    if onnx_path and config_path and voicepack_path:
        print(f"📁 Phát hiện model local tại: {onnx_path.parent}")
        kwargs.update({
            "onnx_path": str(onnx_path),
            "config_path": str(config_path),
            "voicepack_path": str(voicepack_path),
        })
    else:
        print("🌐 Không thấy model trong thư mục mặc định, Kokoro sẽ nạp/tải từ HuggingFace cache...")

    print("⏳ Đang nạp model Kokoro ONNX...")
    t_start = time.perf_counter()
    try:
        model = KokoroVietnameseONNX(**kwargs)
    except Exception as e:
        print(f"❌ Lỗi nạp model: {e}")
        return
    t_load = time.perf_counter() - t_start
    print(f"✅ Nạp model thành công trong {t_load:.2f}s!")

    # 1. Warmup
    print("\n🔥 Đang chạy Warmup câu ngắn để ổn định ONNX Runtime cache...")
    _ = model.synthesize("Xin chào các bạn, tôi là Đức An.", speed=1.0)
    print("✅ Warmup hoàn tất!\n")

    # 2. Đo đạc các kích thước chunk
    print(f"{'CHUNK SIZE':<12} | {'SỐ TỪ':<6} | {'GEN TIME (s)':<14} | {'AUDIO DUR (s)':<14} | {'RTF':<8} | {'SO VỚI MODAL':<15}")
    print("-" * 85)

    summary_rows = []

    for case in BENCHMARK_CASES:
        target_size = case["target_words"]
        text = case["text"]
        actual_words = len(text.split())

        gen_times = []
        durations = []

        # Chạy 3 lần lấy trung bình
        for run_idx in range(3):
            t0 = time.perf_counter()
            audio, _ = model.synthesize(text, speed=1.0)
            gen_time = time.perf_counter() - t0
            duration = len(audio) / 24000.0

            gen_times.append(gen_time)
            durations.append(duration)

        avg_gen_time = sum(gen_times) / len(gen_times)
        avg_duration = sum(durations) / len(durations)
        rtf = avg_gen_time / avg_duration if avg_duration > 0 else 0.0

        # So sánh với baseline Modal (RTF ~ 0.402)
        # Nếu RTF máy Ubuntu nhỏ hơn -> Nhanh hơn (ví dụ 0.20 vs 0.40 là nhanh hơn 50%)
        # Nếu RTF máy Ubuntu lớn hơn -> Chậm hơn
        pct_diff = ((BASELINE_MODAL_RTF - rtf) / BASELINE_MODAL_RTF) * 100.0
        if pct_diff >= 0:
            comparison = f"Nhanh hơn {pct_diff:.1f}%"
        else:
            comparison = f"Chậm hơn {abs(pct_diff):.1f}%"

        summary_rows.append({
            "target": f"{target_size} từ",
            "words": actual_words,
            "gen_time": avg_gen_time,
            "duration": avg_duration,
            "rtf": rtf,
            "comparison": comparison,
        })

        print(
            f"{target_size:<7} từ | "
            f"{actual_words:<6} | "
            f"{avg_gen_time:<14.3f} | "
            f"{avg_duration:<14.2f} | "
            f"{rtf:<8.3f} | "
            f"{comparison:<15}"
        )

    print("-" * 85)
    print("\n📌 KẾT LUẬN & ĐÁNH GIÁ PIPELINE:")
    avg_total_rtf = sum(r["rtf"] for r in summary_rows) / len(summary_rows)
    overall_speedup = 1.0 / avg_total_rtf if avg_total_rtf > 0 else 0.0
    overall_diff = ((BASELINE_MODAL_RTF - avg_total_rtf) / BASELINE_MODAL_RTF) * 100.0

    print(f" • RTF trung bình trên máy Ubuntu: {avg_total_rtf:.3f} (Nhanh gấp {overall_speedup:.2f}x lần thời gian nói)")
    print(f" • Baseline Modal CPU 2-core    : {BASELINE_MODAL_RTF:.3f}")
    if overall_diff >= 0:
        print(f" • Tổng thể máy Ubuntu: NHANH HƠN Modal CPU {overall_diff:.1f}%")
    else:
        print(f" • Tổng thể máy Ubuntu: CHẬM HƠN Modal CPU {abs(overall_diff):.1f}%")

    chunk_15 = summary_rows[0]
    if chunk_15["gen_time"] < 2.0:
        print(f" • Chunk đầu tiên ({chunk_15['words']} từ) gen trong {chunk_15['gen_time']:.2f}s -> ✅ ĐẠT MỤC TIÊU DƯỚI 2 GIÂY!")
    else:
        print(f" • Chunk đầu tiên ({chunk_15['words']} từ) gen trong {chunk_15['gen_time']:.2f}s -> ⚠️ Vượt 2s một chút")

    print("=" * 85)


if __name__ == "__main__":
    main()
