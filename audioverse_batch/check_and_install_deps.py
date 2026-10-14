#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AudioVerse Dependency Checker & Auto-Installer.
Tự động kiểm tra và cài đặt tất cả thư viện cần thiết cho AudioVerse Streaming & Kokoro TTS.

Sử dụng:
  - Chạy trực tiếp từ terminal: python check_and_install_deps.py
  - Hoặc import tự động trong code:
      from check_and_install_deps import ensure_dependencies
      ensure_dependencies()
"""

import sys
import subprocess
import importlib

# Danh mục thư viện bắt buộc và phiên bản tương thích
REQUIRED_PACKAGES = {
    "fastapi": "fastapi>=0.109.0",
    "uvicorn": "uvicorn>=0.27.0",
    "pydantic": "pydantic>=2.0.0",
    "onnxruntime": "onnxruntime>=1.17.0",
    "torch": "torch>=2.1.0",
    "soundfile": "soundfile>=0.12.1",
    "huggingface_hub": "huggingface_hub>=0.20.0",
    "vig2p": "vig2p>=0.1.0",
    "bs4": "beautifulsoup4>=4.12.0",
    "numpy": "numpy>=1.24.0,<2.0.0",
    "requests": "requests>=2.28.0",
    "imageio_ffmpeg": "imageio-ffmpeg>=0.4.9",
}

def check_missing_packages():
    """Kiểm tra xem các package đã được cài đặt và import được hay chưa."""
    missing = []
    for module_name, pip_spec in REQUIRED_PACKAGES.items():
        try:
            importlib.import_module(module_name)
        except ImportError:
            missing.append(pip_spec)
    return missing

def ensure_dependencies(auto_install=True):
    """
    Kiểm tra và tự động cài đặt nếu thiếu package.
    Trả về True nếu tất cả thư viện đều sẵn sàng.
    """
    missing = check_missing_packages()
    if not missing:
        print("[Dependency Checker] ✅ Tất cả thư viện phụ thuộc đã sẵn sàng!")
        return True

    print(f"[Dependency Checker] ⚠️ Phát hiện thiếu {len(missing)} thư viện: {', '.join(missing)}")
    if not auto_install:
        return False

    print("[Dependency Checker] 🚀 Đang tự động tải và cài đặt qua pip...")
    try:
        cmd = [sys.executable, "-m", "pip", "install"] + missing
        subprocess.check_call(cmd)
        print("[Dependency Checker] ✅ Đã cài đặt thành công tất cả thư viện thiếu!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[Dependency Checker Error] Không thể cài đặt tự động: {e}")
        print(f"[Hướng dẫn] Vui lòng chạy lệnh thủ công: pip install {' '.join(missing)}")
        return False

if __name__ == "__main__":
    success = ensure_dependencies(auto_install=True)
    sys.exit(0 if success else 1)
