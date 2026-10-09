import AsyncStorage from '@react-native-async-storage/async-storage';
import { Book } from '../types';

/**
 * Ghi nhớ tiến độ nghe: đang nghe truyện nào, chương bao nhiêu,
 * đến câu thứ mấy (sentenceIndex) và mili-giây thứ mấy trong câu.
 */
export interface ReadingProgress {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  sentenceIndex: number;
  positionMs: number;
  totalSentences: number;
  lastListenedAt: number;
}

const KEYS = {
  BOOKS: '@audioverse/books', // Book[] do người dùng import/cào (full text)
  PROGRESS: '@audioverse/progress', // ReadingProgress | null
  PROGRESS_MAP: '@audioverse/progress_map', // Record<bookId, ReadingProgress>
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.log('[Storage] write error:', e);
  }
}

class StorageService {
  // ---------- Sách đã lưu (full text offline) ----------

  public async getSavedBooks(): Promise<Book[]> {
    return readJson<Book[]>(KEYS.BOOKS, []);
  }

  public async saveBook(book: Book): Promise<void> {
    const books = await this.getSavedBooks();
    const idx = books.findIndex(b => b.id === book.id);
    if (idx >= 0) {
      books[idx] = book;
    } else {
      books.unshift(book);
    }
    await writeJson(KEYS.BOOKS, books);
  }

  public async deleteBook(bookId: string): Promise<void> {
    const books = await this.getSavedBooks();
    await writeJson(
      KEYS.BOOKS,
      books.filter(b => b.id !== bookId)
    );
    // Xóa luôn tiến độ của sách này
    const map = await readJson<Record<string, ReadingProgress>>(KEYS.PROGRESS_MAP, {});
    delete map[bookId];
    await writeJson(KEYS.PROGRESS_MAP, map);
    const last = await this.getLastProgress();
    if (last && last.bookId === bookId) {
      await AsyncStorage.removeItem(KEYS.PROGRESS);
    }
  }

  public async getBook(bookId: string): Promise<Book | null> {
    const books = await this.getSavedBooks();
    return books.find(b => b.id === bookId) || null;
  }

  // ---------- Tiến độ nghe ----------

  /** Tiến độ nghe gần nhất (để hiện nút "Tiếp tục nghe"). */
  public async getLastProgress(): Promise<ReadingProgress | null> {
    return readJson<ReadingProgress | null>(KEYS.PROGRESS, null);
  }

  public async getProgress(bookId: string): Promise<ReadingProgress | null> {
    const map = await readJson<Record<string, ReadingProgress>>(KEYS.PROGRESS_MAP, {});
    return map[bookId] || null;
  }

  public async saveProgress(p: ReadingProgress): Promise<void> {
    const progress: ReadingProgress = { ...p, lastListenedAt: Date.now() };
    await writeJson(KEYS.PROGRESS, progress);
    const map = await readJson<Record<string, ReadingProgress>>(KEYS.PROGRESS_MAP, {});
    map[progress.bookId] = progress;
    await writeJson(KEYS.PROGRESS_MAP, map);
  }

  public async clearProgress(bookId: string): Promise<void> {
    const map = await readJson<Record<string, ReadingProgress>>(KEYS.PROGRESS_MAP, {});
    delete map[bookId];
    await writeJson(KEYS.PROGRESS_MAP, map);
    const last = await this.getLastProgress();
    if (last && last.bookId === bookId) {
      await AsyncStorage.removeItem(KEYS.PROGRESS);
    }
  }
}

export const storageService = new StorageService();
