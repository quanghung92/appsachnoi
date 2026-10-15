/**
 * fetch với timeout — luôn clear timer dù thành công, lỗi hay bị abort.
 * Dùng thay cho pattern thủ công `AbortController + setTimeout + clearTimeout`
 * để tránh rò rỉ timer khi request thất bại sớm.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}
