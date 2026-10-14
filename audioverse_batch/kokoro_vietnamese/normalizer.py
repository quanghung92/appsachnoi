#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Module Chuẩn hóa Văn bản Tiếng Việt (Vietnamese Text Normalizer) cho TTS Kokoro.
Không phụ thuộc thư viện ngoài (Pure Python), tốc độ xử lý siêu nhanh (< 1ms/chương).
"""

import re
import unicodedata

# Bảng chữ số tiếng Việt cơ bản
DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
UNITS_GROUP = ["", "nghìn", "triệu", "tỷ"]

# Đơn vị đo lường (viết thường để match regex)
MEASUREMENTS_MAP = {
    "km/h": "ki-lô-mét trên giờ",
    "km": "ki-lô-mét",
    "cm": "xen-ti-mét",
    "mm": "mi-li-mét",
    "m2": "mét vuông",
    "m3": "mét khối",
    "m": "mét",
    "kg": "ki-lô-gam",
    "g": "gam",
    "ml": "mi-li-lít",
    "l": "lít",
    "°c": "độ xê",
    "%": "phần trăm",
    "đ": "đồng",
    "vnd": "đồng",
    "vnđ": "đồng",
    "usd": "đô la",
}

# Viết tắt danh xưng & thông dụng
ABBREVIATIONS = [
    (r"(?i)\bTP\.\s*", "thành phố "),
    (r"(?i)\bGS\.\s*", "giáo sư "),
    (r"(?i)\bPGS\.\s*", "phó giáo sư "),
    (r"(?i)\bTS\.\s*", "tiến sĩ "),
    (r"(?i)\bThS\.\s*", "thạc sĩ "),
    (r"(?i)\bBS\.\s*", "bác sĩ "),
    (r"(?i)(?:^|(?<=\s))đ/c(?:$|(?=[\s.,!?;:]))", "đồng chí"),
    (r"(?i)\bv\.v\.\.\.", "vân vân"),
    (r"(?i)\bv\.v\.", "vân vân"),
    (r"(?i)\bNXB\b", "nhà xuất bản"),
    (r"(?i)\bUBND\b", "ủy ban nhân dân"),
    (r"(?i)\bHĐND\b", "hội đồng nhân dân"),
    (r"(?i)\bTW\b", "trung ương"),
    (r"(?i)\bTƯ\b", "trung ương"),
]

# Viết tắt mạng / truyện teen code thông dụng
SLANG_WORDS = [
    (r"(?i)\bko\b", "không"),
    (r"(?i)\bk\b", "không"),
    (r"(?i)\bdc\b", "được"),
    (r"(?i)\bđc\b", "được"),
    (r"(?i)\bj\b", "gì"),
    (r"(?i)\bng\b", "người"),
    (r"(?i)\bntn\b", "như thế nào"),
]


def _read_three_digits(num_str: str, is_leading: bool = False) -> str:
    """Đọc nhóm 3 chữ số theo quy tắc ngữ âm tiếng Việt."""
    num_str = num_str.zfill(3)
    h, t, u = int(num_str[0]), int(num_str[1]), int(num_str[2])

    parts = []

    # Hàng trăm
    if h > 0 or not is_leading:
        parts.append(f"{DIGITS[h]} trăm")

    # Hàng chục
    if t > 1:
        parts.append(f"{DIGITS[t]} mươi")
    elif t == 1:
        parts.append("mười")
    elif t == 0:
        if (h > 0 or not is_leading) and u > 0:
            parts.append("lẻ")

    # Hàng đơn vị
    if u > 0:
        if u == 1:
            if t > 1:
                parts.append("mốt")
            else:
                parts.append("một")
        elif u == 4:
            if t > 1:
                parts.append("tư")
            else:
                parts.append("bốn")
        elif u == 5:
            if t > 0:
                parts.append("lăm")
            else:
                parts.append("năm")
        else:
            parts.append(DIGITS[u])
    elif u == 0 and h == 0 and t == 0 and is_leading:
        parts.append("không")

    return " ".join(parts).strip()


def number_to_words(n: int) -> str:
    """Chuyển đổi một số nguyên thành chữ tiếng Việt."""
    if n == 0:
        return "không"
    if n < 0:
        return "âm " + number_to_words(abs(n))

    s = str(n)
    groups = []
    while len(s) > 0:
        groups.append(s[-3:])
        s = s[:-3]

    parts = []
    for idx, grp in enumerate(groups):
        grp_int = int(grp)
        if grp_int > 0:
            unit_name = UNITS_GROUP[idx % 3]
            num_tys = idx // 3
            ty_suffix = " ".join(["tỷ"] * num_tys) if num_tys > 0 else ""

            is_leading = (idx == len(groups) - 1)
            group_words = _read_three_digits(grp, is_leading=is_leading)

            scale_str = f"{unit_name} {ty_suffix}".strip()
            if scale_str:
                parts.append(f"{group_words} {scale_str}")
            else:
                parts.append(group_words)

    parts.reverse()
    return " ".join(parts).strip()


def normalize_numbers(text: str) -> str:
    """Chuyển đổi các dạng số thông dụng trong văn bản sang chữ."""

    # 1. Ngày tháng năm dạng DD/MM/YYYY (tránh lặp từ 'ngày' nếu câu gốc đã có)
    def _replace_date_full(m):
        has_ngay = bool(m.group(1))
        d, mth, y = m.group(2), m.group(3), m.group(4)
        prefix = "ngày " if not has_ngay else ""
        return f"{prefix}{number_to_words(int(d))} tháng {number_to_words(int(mth))} năm {number_to_words(int(y))}"
    text = re.sub(r"(?i)(\bngày\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", _replace_date_full, text)

    # 2. Ngày tháng dạng DD/MM (ví dụ 15/08)
    def _replace_day_month(m):
        has_ngay = bool(m.group(1))
        d, mth = m.group(2), m.group(3)
        if int(d) <= 31 and 1 <= int(mth) <= 12:
            prefix = "ngày " if not has_ngay else ""
            return f"{prefix}{number_to_words(int(d))} tháng {number_to_words(int(mth))}"
        return m.group(0)
    text = re.sub(r"(?i)(\bngày\s+)?(\d{1,2})[/](\d{1,2})\b", _replace_day_month, text)

    # 3. Giờ giấc dạng 14h30 hoặc 14:30
    def _replace_time(m):
        h, mn = m.group(1), m.group(2)
        if mn:
            return f"{number_to_words(int(h))} giờ {number_to_words(int(mn))} phút"
        return f"{number_to_words(int(h))} giờ"
    text = re.sub(r"\b(\d{1,2})[h:](\d{1,2})\b", _replace_time, text)

    # 4. Số kèm tiền tệ viết tắt: 250k, 50tr, 10 tỷ
    def _replace_money_k(m):
        val = int(m.group(1))
        return f"{number_to_words(val)} nghìn"
    text = re.sub(r"\b(\d+)\s*[kK]\b", _replace_money_k, text)

    def _replace_money_tr(m):
        val = int(m.group(1))
        return f"{number_to_words(val)} triệu"
    text = re.sub(r"\b(\d+)\s*(?:tr|triệu)\b", _replace_money_tr, text)

    # 5. Số đi liền đơn vị đo lường / tiền tệ (ví dụ 3.5km, 500đ, 35°C, 15%)
    # Cho phép cả số thập phân (3.5 hoặc 3,5) và số nguyên (500)
    def _replace_number_with_unit(m):
        num_str = m.group(1).replace(",", ".")
        unit_str = m.group(2).lower()
        slash_unit = m.group(3)  # nếu có /lít, /h...

        # Đọc phần số
        if "." in num_str:
            int_p, dec_p = num_str.split(".")
            int_w = number_to_words(int(int_p))
            dec_w = " ".join([DIGITS[int(d)] for d in dec_p])
            num_words = f"{int_w} phẩy {dec_w}"
        else:
            num_words = number_to_words(int(num_str))

        unit_words = MEASUREMENTS_MAP.get(unit_str, unit_str)
        result = f"{num_words} {unit_words}"
        if slash_unit:
            clean_slash = slash_unit.lstrip("/").strip().lower()
            slash_words = MEASUREMENTS_MAP.get(clean_slash, clean_slash)
            result += f" trên {slash_words}"
        return result

    unit_regex = r"(?i)\b(\d+(?:[.,]\d+)?)\s*(km/h|km|cm|mm|m2|m3|m|kg|g|ml|l|°c|%|đ|vnd|vnđ|usd)(?:/([^\s.,!?;:]+))?(?=[\s.,!?;:]|$)"
    text = re.sub(unit_regex, _replace_number_with_unit, text)

    # 6. Số thập phân đứng độc lập không kèm đơn vị (ví dụ 3.5 hoặc 3,5)
    def _replace_decimal(m):
        int_part = int(m.group(1))
        dec_str = m.group(2)
        dec_words = " ".join([DIGITS[int(d)] for d in dec_str])
        return f"{number_to_words(int_part)} phẩy {dec_words}"
    text = re.sub(r"\b(\d+)[.,](\d+)\b", _replace_decimal, text)

    # 7. Số nguyên độc lập còn lại (ví dụ Chương 125)
    def _replace_integer(m):
        val = int(m.group(0))
        return number_to_words(val)
    text = re.sub(r"\b\d+\b", _replace_integer, text)

    return text


def normalize_text_for_tts(text: str) -> str:
    """
    Hàm tổng thể chuẩn hóa toàn bộ văn bản trước khi đưa vào Vig2p / Kokoro.
    """
    if not text:
        return ""

    # 1. Ép chuẩn Unicode NFC (tránh lỗi font tổ hợp ký tự tiếng Việt)
    text = unicodedata.normalize("NFC", text)

    # 2. Xóa các ký tự trang trí rác web truyện
    text = re.sub(r"[\*=\-_~]{3,}", " ", text)
    text = re.sub(r"\(adsbygoogle[\s\S]*?\);", " ", text)

    # 3. Chuẩn hóa dấu gạch ngang hội thoại đầu câu (- "..." hoặc - Này!)
    text = re.sub(r"(?:^|\n)\s*[-–—]\s*", "\n", text)
    text = re.sub(r'[""«»“”]', '"', text)

    # 4. Mở rộng từ viết tắt danh xưng
    for pattern, replacement in ABBREVIATIONS:
        text = re.sub(pattern, replacement, text)

    # 5. Mở rộng từ lóng truyện mạng thông dụng
    for pattern, replacement in SLANG_WORDS:
        text = re.sub(pattern, replacement, text)

    # 6. Xử lý các dạng số (ngày tháng, giờ, phần trăm, số đếm, đơn vị đo lường)
    text = normalize_numbers(text)

    # 7. Chuẩn hóa khoảng trắng & dấu câu
    text = re.sub(r"\.{3,}|…", ", ", text)  # ba chấm -> dấu phẩy ngắt hơi nhẹ
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)

    return text.strip()


if __name__ == "__main__":
    test_samples = [
        "Hôm nay là ngày 15/08/2024, TP. Hà Nội đón cơn mưa lớn lúc 14h30.",
        "Hàn Lập tiêu tốn hết 250k linh thạch, đạt được 15% tiến độ tu luyện.",
        "- Này! Đ/c đừng đi nữa, phía trước cách đây 3.5km có lôi kiếp đấy, ko đùa dc đâu!",
        "Chương 125: Giá xăng giảm 500đ/lít, nhiệt độ ngoài trời khoảng 35°C...",
        "GS. Trần Văn A cùng TS. Nguyễn Thị B công bố công trình lúc 9:15 sáng.",
    ]

    print("=" * 80)
    print("KIỂM THỬ MODULE VIETNAMESE NORMALIZER CHO KOKORO TTS")
    print("=" * 80)
    for sample in test_samples:
        print(f"\n[GỐC]   : {sample}")
        print(f"[CHUẨN] : {normalize_text_for_tts(sample)}")
    print("=" * 80)
