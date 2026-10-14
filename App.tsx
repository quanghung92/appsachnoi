import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from './src/theme/colors';
import { Book, Chapter, VoiceOption } from './src/types';
import { DRIVE_BOOKS } from './src/data/books';
import { WEB_NOVELS } from './src/data/novels';
import { ttsService, VIETNAMESE_VOICES } from './src/services/ttsService';
import { batchService, BatchEngine, toIndexChapterId } from './src/services/batchService';
import { storageService, ReadingProgress } from './src/services/storageService';
import { crawlerService } from './src/services/crawlerService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Components
import { Header } from './src/components/Header';
import { MiniPlayer } from './src/components/MiniPlayer';
import { FullPlayerModal } from './src/components/FullPlayerModal';
import { ChapterListModal } from './src/components/ChapterListModal';
import { BatchQueueModal } from './src/components/BatchQueueModal';
import { VoiceSelectorModal } from './src/components/VoiceSelectorModal';
import { SleepTimerModal } from './src/components/SleepTimerModal';
import { UrlImportModal } from './src/components/UrlImportModal';

// Screens
import { HomeScreen } from './src/screens/HomeScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { QueueScreen } from './src/screens/QueueScreen';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'library' | 'queue'>('home');
  // Responsive: hỗ trợ tất cả kích thước màn hình (mobile < 768px, tablet 768-1024px, desktop >= 1024px)
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const isTablet = isWide && width < 1024;
  const isDesktop = width >= 1024;
  const [selectedCategory, setSelectedCategory] = useState<string>('Tất Cả');

  const tabTitles: Record<string, string> = {
    home: 'Khám Phá Sách & Truyện',
    search: 'Tìm Kiếm Kho Sách',
    library: 'Tủ Sách Của Tôi',
    queue: 'Hàng Đợi Gen Audio',
  };

  // Book Data
  const [books, setBooks] = useState<Book[]>(DRIVE_BOOKS);
  const [novels, setNovels] = useState<Book[]>(WEB_NOVELS);
  const [recentBooks, setRecentBooks] = useState<Book[]>([]);
  const [savedBooks, setSavedBooks] = useState<Book[]>([]);

  // Playback State
  const [currentBook, setCurrentBook] = useState<Book | null>(DRIVE_BOOKS[0]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(
    DRIVE_BOOKS[0].chapters[0]
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [positionMs, setPositionMs] = useState<number>(0);
  const [durationMs, setDurationMs] = useState<number>(10000);
  const [speed, setSpeed] = useState<number>(1.0);
  const [currentVoice, setCurrentVoice] = useState<VoiceOption>(VIETNAMESE_VOICES[0]);

  // BƯỚC 3: Read-Along & BGM State
  const [sentences, setSentences] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(0);
  const [bgmVolume, setBgmVolume] = useState<number>(0.35);
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(false);

  // Timer State
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const sleepTimerRef = useRef<any>(null);

  // Modals
  const [isFullPlayerVisible, setIsFullPlayerVisible] = useState<boolean>(false);
  const [isChapterListVisible, setIsChapterListVisible] = useState<boolean>(false);
  const [isBatchQueueVisible, setIsBatchQueueVisible] = useState<boolean>(false);
  const [isVoiceSelectorVisible, setIsVoiceSelectorVisible] = useState<boolean>(false);
  const [isSleepTimerVisible, setIsSleepTimerVisible] = useState<boolean>(false);
  const [isImportModalVisible, setIsImportModalVisible] = useState<boolean>(false);

  // Đọc tiếp (PLAN B2)
  const [lastProgress, setLastProgress] = useState<ReadingProgress | null>(null);
  const [loadingBookId, setLoadingBookId] = useState<string | null>(null);

  // Trạng thái audio từng chương trên batch server (đồng bộ hiển thị với server)
  const [chapterAudioState, setChapterAudioState] = useState<{
    ready: Set<string>;
    pending: Set<string>;
  }>({ ready: new Set<string>(), pending: new Set<string>() });

  // Nạp sách đã lưu + tiến độ nghe khi mở app (phục hồi sách/chương đang nghe dở trên F5)
  useEffect(() => {
    (async () => {
      try {
        let loadedWebNovels: Book[] = [];
        let loadedOthers: Book[] = [];
        const saved = await storageService.getSavedBooks();
        if (saved && saved.length > 0) {
          const webNovels = saved.filter(b => b.type === 'web_novel');
          const others = saved.filter(b => b.type !== 'web_novel');
          if (webNovels.length > 0) {
            setNovels(prev => [...webNovels, ...prev]);
            loadedWebNovels = webNovels;
          }
          if (others.length > 0) {
            setBooks(prev => [...others, ...prev]);
            loadedOthers = others;
          }
          setSavedBooks(saved);
        } else {
          setSavedBooks([]);
        }

        const allPool = [...loadedOthers, ...loadedWebNovels, ...DRIVE_BOOKS, ...WEB_NOVELS];

        // Nạp lịch sử các sách đã nghe dở từ AsyncStorage
        try {
          const rawRecent = await AsyncStorage.getItem('@audioverse/recent_book_ids');
          const recentIds: string[] = rawRecent ? JSON.parse(rawRecent) : [];
          if (recentIds.length > 0) {
            const matched = recentIds
              .map(id => allPool.find(b => b.id === id))
              .filter((b): b is Book => Boolean(b));
            setRecentBooks(matched);
          } else {
            setRecentBooks([]);
          }
        } catch {}

        const progress = await storageService.getLastProgress();
        setLastProgress(progress);
        if (progress) {
          const found = allPool.find(b => b.id === progress.bookId);
          if (found) {
            setCurrentBook(found);
            const foundCh = found.chapters.find(c => c.id === progress.chapterId) || found.chapters[0];
            if (foundCh) setCurrentChapter(foundCh);
            if (progress.positionMs && progress.positionMs > 0) {
              setPositionMs(progress.positionMs);
            }
            // Đảm bảo cuốn đang nghe xuất hiện ở đầu danh sách đang nghe dở
            setRecentBooks(prev => {
              if (prev.some(b => b.id === found.id)) return prev;
              const updated = [found, ...prev].slice(0, 10);
              AsyncStorage.setItem(
                '@audioverse/recent_book_ids',
                JSON.stringify(updated.map(b => b.id))
              ).catch(() => {});
              return updated;
            });
          }
        }
      } catch (e) {
        console.log('[App] load storage error:', e);
      }
    })();
  }, []);

  // Subscribe to TTS Progress
  useEffect(() => {
    const unsubscribe = ttsService.addProgressListener((progress) => {
      setPositionMs(progress.positionMs);
      setDurationMs(progress.durationMs);
      setIsPlaying(progress.isSpeaking);
    });

    const unsubSentences = ttsService.addOnSentencesLoadedListener((newSentences) => {
      setSentences(newSentences);
    });

    return () => {
      unsubscribe();
      unsubSentences();
    };
  }, []);

  const handleSeekToSentence = (index: number) => {
    setCurrentSentenceIndex(index);
    ttsService.seekToSentence(index);
  };

  const handleToggleBgm = () => {
    const nextState = !bgmEnabled;
    setBgmEnabled(nextState);
    ttsService.setBgmEnabled(nextState);
  };

  const handleChangeBgmVolume = (val: number) => {
    setBgmVolume(val);
    ttsService.setBgmVolume(val);
  };

  // Handle Play/Pause
  const handleTogglePlay = async (targetBook?: Book) => {
    const bookToPlay = targetBook || currentBook;
    if (!bookToPlay) return;

    // If tapping another book
    if (bookToPlay.id !== currentBook?.id) {
      setCurrentBook(bookToPlay);
      let targetChapter = bookToPlay.chapters[0];
      let resumeMs = 0;
      let resumeSentence = 0;
      if (lastProgress && lastProgress.bookId === bookToPlay.id) {
        const found = bookToPlay.chapters.find((c) => c.id === lastProgress.chapterId);
        if (found) {
          targetChapter = found;
          resumeMs = lastProgress.positionMs || 0;
          resumeSentence = lastProgress.sentenceIndex > 0 ? lastProgress.sentenceIndex : 0;
        }
      }
      setCurrentChapter(targetChapter);
      await startReading(targetChapter.content, bookToPlay, targetChapter, resumeSentence, resumeMs);
      addToRecent(bookToPlay);
      return;
    }

    // Toggle same book
    if (isPlaying) {
      await ttsService.pause();
      setIsPlaying(false);
    } else if (ttsService.isPausedState()) {
      // Đang pause -> tiếp tục từ chỗ dừng (không đọc lại từ đầu)
      await ttsService.resume();
      setIsPlaying(true);
    } else {
      if (currentChapter) {
        const resumeMs =
          lastProgress && lastProgress.bookId === bookToPlay.id && lastProgress.chapterId === currentChapter.id
            ? lastProgress.positionMs || positionMs || 0
            : positionMs || 0;
        const resumeSentence =
          lastProgress && lastProgress.bookId === bookToPlay.id && lastProgress.chapterId === currentChapter.id && lastProgress.sentenceIndex > 0
            ? lastProgress.sentenceIndex
            : 0;
        await startReading(currentChapter.content, bookToPlay, currentChapter, resumeSentence, resumeMs);
      }
    }
  };

  /**
   * Thử phát audio chương gen sẵn từ batch server (MP3 trên Drive đã tải về máy).
   * Trả về true nếu phát được (chapter-audio mode), false để App dùng Kokoro realtime.
   * sentenceIndex = -1 trong ReadingProgress đánh dấu chapter mode (tiếp tục từ positionMs).
   */
  const tryPlayChapterAudio = async (book: Book, chapter: Chapter, startMs: number = 0): Promise<boolean> => {
    if (!batchService.isConfigured()) return false;
    try {
      setLoadingBookId(book.id);
      const localUri = await batchService.getChapterAudioFile(book.id, chapter.id);
      if (!localUri) return false;

      setIsPlaying(true);
      ttsService.setNowPlaying(book.title, chapter.title);

      // Parse thời lượng dự kiến từ metadata chương (ví dụ: "09:20" -> 560000ms)
      let parsedDurMs = 0;
      if (chapter.duration) {
        const parts = chapter.duration.split(':').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          parsedDurMs = (parts[0] * 60 + parts[1]) * 1000;
        } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          parsedDurMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        }
      }
      if (parsedDurMs > 0) {
        setDurationMs(parsedDurMs);
      }

      await ttsService.playChapterAudio(
        localUri,
        () => {
          handleNextChapter();
        },
        (err) => {
          console.log('[App] Chapter audio error:', err);
          setIsPlaying(false);
        },
        (posMs, durMs) => {
          setPositionMs(posMs);
          if (durMs > 0) setDurationMs(durMs);
          const progress: ReadingProgress = {
            bookId: book.id,
            bookTitle: book.title,
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber || 0,
            chapterTitle: chapter.title,
            sentenceIndex: -1,
            positionMs: Math.floor(posMs),
            totalSentences: 0,
            lastListenedAt: Date.now(),
          };
          setLastProgress(progress);
          storageService.saveProgress(progress).catch(() => {});
        },
        startMs,
        parsedDurMs
      );
      return true;
    } catch (e) {
      console.log('[App] tryPlayChapterAudio failed:', e);
      return false;
    } finally {
      setLoadingBookId(null);
    }
  };

  /**
   * Đẩy chương hiện tại + 2 chương tiếp theo vào hàng đợi batch (cuối hàng).
   * Bỏ qua chương đã có audio hoặc đang chờ gen để tránh trùng.
   */
  const enqueueChapterForBatch = async (book: Book, chapter: Chapter): Promise<number> => {
    try {
      if (!batchService.isConfigured()) return 0;
      const engine: BatchEngine = 'kokoro';
      const voice = await getKokoroVoiceForBook(book.id);
      const [index, pending] = await Promise.all([
        batchService.getChapterIndex(book.id),
        batchService.getPendingChapters(book.id),
      ]);
      const ready = new Set(Object.keys(index));
      const idx = book.chapters.findIndex((c) => c.id === chapter.id);
      const items: {
        book_id: string; chapter_id: string; title: string;
        url?: string; engine: BatchEngine; voice?: string;
      }[] = [];
      for (let i = Math.max(0, idx); i < Math.min(idx + 3, book.chapters.length); i++) {
        const ch = book.chapters[i];
        if (ready.has(ch.id) || ready.has(toIndexChapterId(ch.id)) || pending.has(ch.id)) continue;
        items.push({
          book_id: book.id,
          chapter_id: ch.id,
          title: ch.title,
          url: ch.url || crawlerService.buildChapterUrl(book.sourceUrl, ch.chapterNumber || i + 1),
          engine,
          voice,
        });
      }
      if (items.length > 0) {
        const added = await batchService.enqueueChapters(items);
        console.log(`[App] Đã đẩy ${added} chương vào hàng đợi batch (${engine}).`);
        return added;
      }
      return 0;
    } catch (e) {
      console.log('[App] enqueue batch error:', e);
      return 0;
    }
  };

  /** Giọng Kokoro khóa theo từng sách (1 sách 1 giọng, không pha trộn). */
  const getKokoroVoiceForBook = async (bookId: string): Promise<string> => {
    const DEFAULT = 'duc_an'; // Nguyễn chốt
    try {
      const v = await AsyncStorage.getItem(`@audioverse/book_voice_${bookId}`);
      if (v) return v;
      await AsyncStorage.setItem(`@audioverse/book_voice_${bookId}`, DEFAULT);
    } catch {}
    return DEFAULT;
  };

  /**
   * User chọn batch 1 cuốn sách/truyện cụ thể: đẩy các chương tiếp theo
   * (từ vị trí đang nghe, bỏ qua chương đã có audio / đang chờ) lên ĐẦU hàng đợi.
   * all=true: toàn bộ các chương còn lại; all=false: chỉ 10 chương tiếp theo.
   */
  const handleBatchBook = async (book: Book, all: boolean = false) => {
    try {
      if (!batchService.isConfigured()) {
        Alert.alert('Chưa có batch server', 'Hãy deploy batch server và dán URL vào BATCH_SERVER_URL trước.');
        return;
      }
      // Server batch chỉ chạy Kokoro (Gemini đã tắt từ đêm 11/10) — mọi loại nội dung đều dùng Kokoro.
      const engine: BatchEngine = 'kokoro';
      const voice = await getKokoroVoiceForBook(book.id);
      const [index, pending, progress] = await Promise.all([
        batchService.getChapterIndex(book.id),
        batchService.getPendingChapters(book.id),
        storageService.getProgress(book.id),
      ]);
      const ready = new Set(Object.keys(index));
      let startIdx = 0;
      if (progress) {
        const pi = book.chapters.findIndex((c) => c.id === progress.chapterId);
        if (pi >= 0) startIdx = pi;
      }
      const maxItems = all ? book.chapters.length : 10;
      const items: {
        book_id: string; chapter_id: string; title: string;
        url?: string; engine: BatchEngine; voice?: string;
      }[] = [];
      for (let i = startIdx; i < book.chapters.length && items.length < maxItems; i++) {
        const ch = book.chapters[i];
        if (ready.has(ch.id) || ready.has(toIndexChapterId(ch.id)) || pending.has(ch.id)) continue;
        items.push({
          book_id: book.id,
          chapter_id: ch.id,
          title: ch.title,
          url: ch.url || crawlerService.buildChapterUrl(book.sourceUrl, ch.chapterNumber || i + 1),
          engine,
          voice,
        });
      }
      if (items.length === 0) {
        Alert.alert('Không có gì để batch', 'Các chương tiếp theo đều đã có audio hoặc đang chờ gen.');
        return;
      }
      const added = await batchService.enqueueChapters(items, 'front');
      Alert.alert('Đã xếp hàng', `Đã đẩy ${added} chương của "${book.title}" lên đầu hàng đợi.`);
    } catch (e) {
      console.log('[App] handleBatchBook error:', e);
      Alert.alert('Lỗi', 'Không đẩy được vào hàng đợi.');
    }
  };

  const executeRealtimeReading = async (text: string, book?: Book, chapter?: Chapter, startSentenceIndex: number = 0) => {
    let readingText = text;
    if (book && chapter) {
      try {
        const fullContent = await crawlerService.ensureChapterContent(book, chapter);
        if (fullContent && fullContent.length > readingText.length) {
          readingText = fullContent;
          chapter.content = fullContent;
          setCurrentChapter({ ...chapter, content: fullContent });
        }
      } catch (e) {
        console.log('[App] Error ensuring full chapter content:', e);
      }
    }

    setIsPlaying(true);
    if (book) {
      ttsService.setNowPlaying(book.title, chapter?.title || book.author);
    }

    const voice = (book ? await getKokoroVoiceForBook(book.id) : null) || currentVoice.id || 'duc_an';
    const chapterUrl = chapter?.url || (book ? crawlerService.buildChapterUrl(book.sourceUrl, chapter?.chapterNumber || 1) : '');

    // BƯỚC 3: Stream trực tiếp qua Kokoro Server Streaming (Latency < 1.6s, Gapless 0ms Ping-Pong)
    await ttsService.streamChapter({
      bookId: book?.id || 'default_book',
      chapterId: chapter?.id || 'c1',
      text: readingText,
      url: chapterUrl,
      voice: voice,
      speed: speed,
      startSentenceIndex: startSentenceIndex,
      onFinish: () => {
        handleNextChapter();
      },
      onError: (err) => {
        console.log('[App TTS Error]:', err);
        setIsPlaying(false);
      },
      onSentence: (sentenceIndex, totalSentences) => {
        setCurrentSentenceIndex(sentenceIndex);
        if (book && chapter) {
          const progress: ReadingProgress = {
            bookId: book.id,
            bookTitle: book.title,
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber || 0,
            chapterTitle: chapter.title,
            sentenceIndex,
            positionMs: 0,
            totalSentences,
            lastListenedAt: Date.now(),
          };
          setLastProgress(progress);
          storageService.saveProgress(progress).catch(() => {});
        }
      },
      onSentencesLoaded: (loadedSentences) => {
        setSentences(loadedSentences);
      },
    });
  };

  const startReading = async (
    text: string,
    book?: Book,
    chapter?: Chapter,
    startSentenceIndex: number = 0,
    startMs: number = 0
  ) => {
    try {
      if (book) setLoadingBookId(book.id);
      // 1. Nếu có file MP3 trên Drive -> phát ngay bằng Drive audio player
      if (book && chapter && batchService.isConfigured() && startSentenceIndex <= 0) {
        const played = await tryPlayChapterAudio(book, chapter, startMs);
        if (played) return;

        // 2. Chưa có audio trên Drive -> stream trực tiếp luôn, không hỏi
        await executeRealtimeReading(text, book, chapter, startSentenceIndex);
        return;
      }

      // 3. Đọc ngay bằng TTS trực tiếp
      await executeRealtimeReading(text, book, chapter, startSentenceIndex);
    } finally {
      setLoadingBookId(null);
    }
  };

  /** Tiếp tục nghe từ chỗ đang dở (PLAN B2). */
  const handleResume = async () => {
    if (!lastProgress) return;
    const allBooks = [...books, ...novels];
    const book = allBooks.find(b => b.id === lastProgress.bookId);
    if (!book) {
      Alert.alert('Không tìm thấy sách', 'Sách này có thể đã bị xóa khỏi tủ.');
      return;
    }
    const chapter =
      book.chapters.find(c => c.id === lastProgress.chapterId) || book.chapters[0];
    if (!chapter) return;
    setCurrentBook(book);
    setCurrentChapter(chapter);
    addToRecent(book);
    if (lastProgress.sentenceIndex === -1) {
      // Chapter-audio mode: thử phát MP3 chương từ batch, tiếp tục từ positionMs.
      // Không có audio sẵn -> rớt về Kokoro realtime từ đầu chương.
      const played = await tryPlayChapterAudio(book, chapter, lastProgress.positionMs || 0);
      if (!played) {
        await startReading(chapter.content, book, chapter, 0, 0);
      }
    } else {
      await startReading(
        chapter.content,
        book,
        chapter,
        lastProgress.sentenceIndex,
        0
      );
    }
    setIsFullPlayerVisible(true);
  };

  /** Mở danh sách chương + tải trạng thái audio từ batch server (đồng bộ). */
  const openChapterList = async () => {
    setIsChapterListVisible(true);
    if (currentBook && batchService.isConfigured()) {
      try {
        const [index, pending] = await Promise.all([
          batchService.getChapterIndex(currentBook.id),
          batchService.getPendingChapters(currentBook.id),
        ]);
        setChapterAudioState({ ready: new Set(Object.keys(index)), pending });

        // Tự động đồng bộ các chương đã gen trên server nếu sách có nhiều chương hơn (vd: Phàm Nhân Tu Tiên 459 chương)
        const indexKeys = Object.keys(index);
        if (indexKeys.length > currentBook.chapters.length) {
          const sortedKeys = indexKeys.sort((a, b) => {
            const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return na - nb;
          });
          const existingIds = new Set(currentBook.chapters.map(c => toIndexChapterId(c.id)));
          const additionalChapters: Chapter[] = [];
          for (const k of sortedKeys) {
            if (!existingIds.has(k)) {
              const item = index[k];
              const chapNum = parseInt(k.replace(/\D/g, ''), 10) || 0;
              additionalChapters.push({
                id: `${currentBook.id}_${k}`,
                chapterNumber: chapNum,
                title: item.title || `Chương ${chapNum}`,
                content: item.title || `Chương ${chapNum}`,
                duration: '10:00',
              });
            }
          }
          if (additionalChapters.length > 0) {
            const updatedBook = {
              ...currentBook,
              chapters: [...currentBook.chapters, ...additionalChapters],
            };
            setCurrentBook(updatedBook);
          }
        }
      } catch {}
    } else {
      setChapterAudioState({ ready: new Set<string>(), pending: new Set<string>() });
    }
  };

  /** Xóa sách khỏi tủ (kèm xác nhận, PLAN B2). */
  const handleDeleteBook = (book: Book) => {
    const doDelete = async () => {
      await storageService.deleteBook(book.id);
      // Đồng bộ: xóa luôn hàng đợi + audio trên batch server / Drive
      batchService.removeBook(book.id).catch(() => {});
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
      setNovels((prev) => prev.filter((b) => b.id !== book.id));
      setSavedBooks((prev) => prev.filter((b) => b.id !== book.id));
      setRecentBooks((prev) => {
        const updated = prev.filter((b) => b.id !== book.id);
        AsyncStorage.setItem(
          '@audioverse/recent_book_ids',
          JSON.stringify(updated.map((b) => b.id))
        ).catch(() => {});
        return updated;
      });
      if (currentBook?.id === book.id) {
        ttsService.stop();
        setCurrentBook(null);
        setCurrentChapter(null);
        setIsPlaying(false);
      }
      const progress = await storageService.getLastProgress();
      setLastProgress(progress);
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Xóa "${book.title}" khỏi tủ sách? Toàn bộ nội dung và tiến độ nghe sẽ bị xóa khỏi máy.`)) {
        doDelete();
      }
      return;
    }

    Alert.alert(
      'Xóa sách',
      `Xóa "${book.title}" khỏi tủ sách? Toàn bộ nội dung và tiến độ nghe sẽ bị xóa khỏi máy.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: doDelete,
        },
      ]
    );
  };

  const handleSelectBook = (book: Book, chapter?: Chapter) => {
    setCurrentBook(book);
    let targetChapter = chapter || book.chapters[0];
    if (!chapter && lastProgress && lastProgress.bookId === book.id) {
      const found = book.chapters.find((c) => c.id === lastProgress.chapterId);
      if (found) targetChapter = found;
    }
    setCurrentChapter(targetChapter);
    setIsFullPlayerVisible(true);
    addToRecent(book);
  };

  const handleSelectChapter = (chapter: Chapter) => {
    setSentences([]);
    setCurrentSentenceIndex(0);
    setCurrentChapter(chapter);
    if (currentBook) {
      startReading(chapter.content, currentBook, chapter, 0, 0);
    }
  };

  const handleNextChapter = () => {
    if (!currentBook || !currentChapter) return;
    const currentIndex = currentBook.chapters.findIndex((c) => c.id === currentChapter.id);
    if (currentIndex >= 0 && currentIndex < currentBook.chapters.length - 1) {
      const next = currentBook.chapters[currentIndex + 1];
      setSentences([]);
      setCurrentSentenceIndex(0);
      setCurrentChapter(next);
      startReading(next.content, currentBook, next);
    } else {
      // Reached the end
      ttsService.stop();
      setIsPlaying(false);
    }
  };

  const handlePrevChapter = () => {
    if (!currentBook || !currentChapter) return;
    const currentIndex = currentBook.chapters.findIndex((c) => c.id === currentChapter.id);
    if (currentIndex > 0) {
      const prev = currentBook.chapters[currentIndex - 1];
      setSentences([]);
      setCurrentSentenceIndex(0);
      setCurrentChapter(prev);
      startReading(prev.content, currentBook, prev);
    }
  };

  const handleSeek = async (ms: number) => {
    // Tua thật trên audio đang phát (engine Edge-TTS)
    setPositionMs(ms);
    try {
      await ttsService.seekTo(ms);
    } catch {
      /* engine giọng hệ thống không hỗ trợ tua */
    }
  };

  const handleChangeSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIndex = (speeds.indexOf(speed) + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];
    setSpeed(newSpeed);
    ttsService.setSpeed(newSpeed);
  };

  const handleSelectVoice = (voice: VoiceOption) => {
    setCurrentVoice(voice);
    ttsService.setVoice(voice);
  };

  const handleTestVoice = (voice: VoiceOption) => {
    setCurrentVoice(voice);
    ttsService.setVoice(voice);
  };

  const handleSetSleepTimer = (minutes: number | null) => {
    setSleepTimerMinutes(minutes);
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }

    if (minutes !== null && minutes > 0) {
      sleepTimerRef.current = setTimeout(() => {
        ttsService.stop();
        setIsPlaying(false);
        setSleepTimerMinutes(null);
      }, minutes * 60 * 1000);
    }
  };

  const handleBookImported = (newBook: Book, playImmediately: boolean) => {
    if (newBook.type === 'web_novel') {
      setNovels((prev) => [newBook, ...prev]);
    } else {
      setBooks((prev) => [newBook, ...prev]);
    }
    setSavedBooks((prev) => [newBook, ...prev]);
    // Lưu offline vào máy (PLAN B2)
    storageService.saveBook(newBook).catch(() => {});

    if (playImmediately) {
      setCurrentBook(newBook);
      const chapter = newBook.chapters[0];
      setCurrentChapter(chapter);
      startReading(chapter.content, newBook, chapter);
      setIsFullPlayerVisible(true);
    }
  };

  const addToRecent = (book: Book) => {
    setRecentBooks((prev) => {
      const filtered = prev.filter((b) => b.id !== book.id);
      const updated = [book, ...filtered].slice(0, 10);
      AsyncStorage.setItem(
        '@audioverse/recent_book_ids',
        JSON.stringify(updated.map((b) => b.id))
      ).catch(() => {});
      return updated;
    });
  };

  const handleRemoveRecentBook = (book: Book) => {
    const doRemove = () => {
      setRecentBooks((prev) => {
        const updated = prev.filter((b) => b.id !== book.id);
        AsyncStorage.setItem(
          '@audioverse/recent_book_ids',
          JSON.stringify(updated.map((b) => b.id))
        ).catch(() => {});
        return updated;
      });
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Xóa "${book.title}" khỏi danh sách đang nghe dở?`)) {
        doRemove();
      }
      return;
    }

    Alert.alert(
      'Xóa khỏi lịch sử',
      `Xóa "${book.title}" khỏi danh sách đang nghe dở?`,
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Xóa', style: 'destructive', onPress: doRemove },
      ]
    );
  };

  const allBooksList = [...books, ...novels];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={[styles.appContainer, isWide && styles.appContainerWide]}>
        {/* Sidebar cho web rộng */}
        {isWide && (
          <View style={[styles.sidebar, isTablet && styles.sidebarTablet]}>
            <View style={styles.sidebarLogo}>
              <Ionicons name="book" size={28} color={Colors.primary} />
              <Text style={styles.sidebarLogoText}>AudioVerse</Text>
            </View>
            {(
              [
                { key: 'home', label: 'Khám Phá', icon: 'home', iconOutline: 'home-outline' },
                { key: 'search', label: 'Tìm Kiếm', icon: 'search', iconOutline: 'search-outline' },
                { key: 'library', label: 'Tủ Sách', icon: 'library', iconOutline: 'library-outline' },
                { key: 'queue', label: 'Hàng Đợi', icon: 'cloud-upload', iconOutline: 'cloud-upload-outline' },
              ] as const
            ).map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.sidebarTab, activeTab === tab.key && styles.sidebarTabActive]}
                onPress={() => setActiveTab(tab.key)}
                accessibilityLabel={tab.label}
              >
                <Ionicons
                  name={activeTab === tab.key ? tab.icon : tab.iconOutline}
                  size={22}
                  color={activeTab === tab.key ? Colors.primary : Colors.textMuted}
                />
                <Text
                  style={[
                    styles.sidebarLabel,
                    activeTab === tab.key && { color: Colors.primary, fontWeight: '700' },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Cột nội dung chính */}
        <View style={styles.mainColumn}>
          <View style={styles.mainColumnInner}>
            {/* Top Header */}
            <Header
              currentVoice={currentVoice}
              onOpenVoiceSelector={() => setIsVoiceSelectorVisible(true)}
              onOpenImportModal={() => setIsImportModalVisible(true)}
              sleepTimerMinutes={sleepTimerMinutes}
              onOpenSleepTimer={() => setIsSleepTimerVisible(true)}
              isWide={isWide}
              activeTabTitle={tabTitles[activeTab]}
            />

            {/* Screen Switcher */}
            <View style={styles.screenContainer}>
          {activeTab === 'home' && (
            <HomeScreen
              books={books}
              novels={novels}
              currentBook={currentBook}
              isPlaying={isPlaying}
              loadingBookId={loadingBookId}
              selectedCategory={selectedCategory}
              lastProgress={lastProgress}
              onSelectCategory={setSelectedCategory}
              onSelectBook={handleSelectBook}
              onTogglePlay={handleTogglePlay}
              onOpenImportModal={() => setIsImportModalVisible(true)}
              onResume={handleResume}
            />
          )}

          {activeTab === 'search' && (
            <SearchScreen
              books={allBooksList}
              currentBook={currentBook}
              isPlaying={isPlaying}
              onSelectBook={handleSelectBook}
              onTogglePlay={handleTogglePlay}
              onOpenImportModal={() => setIsImportModalVisible(true)}
            />
          )}

          {activeTab === 'library' && (
            <LibraryScreen
              recentBooks={recentBooks}
              savedBooks={savedBooks}
              currentBook={currentBook}
              isPlaying={isPlaying}
              onSelectBook={handleSelectBook}
              onTogglePlay={handleTogglePlay}
              onOpenImportModal={() => setIsImportModalVisible(true)}
              onDeleteBook={handleDeleteBook}
              onRemoveRecentBook={handleRemoveRecentBook}
            />
          )}

          {activeTab === 'queue' && (
            <QueueScreen
              books={allBooksList}
              onSelectBook={handleSelectBook}
              onBatchBook={handleBatchBook}
            />
          )}
        </View>

        {/* Floating Mini Player */}
        {currentBook && currentChapter && (
          <View style={[styles.miniPlayerBox, isWide && styles.miniPlayerBoxWide]}>
            <MiniPlayer
              book={currentBook}
              chapter={currentChapter}
              isPlaying={isPlaying}
              isLoading={loadingBookId !== null && (loadingBookId === currentBook?.id || loadingBookId === 'current')}
              positionMs={positionMs}
              durationMs={durationMs}
              onPress={() => setIsFullPlayerVisible(true)}
              onPlayPause={() => handleTogglePlay()}
              onNextChapter={handleNextChapter}
              onSeek={handleSeek}
            />
          </View>
        )}

        {/* Navigation: bottom nav trên mobile (web rộng dùng sidebar) */}
        {!isWide && (
          <View style={styles.bottomNav}>
            <TouchableOpacity
              style={styles.navTab}
              onPress={() => setActiveTab('home')}
              accessibilityLabel="Khám phá"
            >
              <Ionicons
                name={activeTab === 'home' ? 'home' : 'home-outline'}
                size={22}
                color={activeTab === 'home' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'home' && { color: Colors.primary, fontWeight: '700' },
                ]}
              >
                Khám Phá
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navTab}
              onPress={() => setActiveTab('search')}
              accessibilityLabel="Tìm kiếm"
            >
              <Ionicons
                name={activeTab === 'search' ? 'search' : 'search-outline'}
                size={22}
                color={activeTab === 'search' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'search' && { color: Colors.primary, fontWeight: '700' },
                ]}
              >
                Tìm Kiếm
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navTab}
              onPress={() => setActiveTab('library')}
              accessibilityLabel="Tủ sách"
            >
              <Ionicons
                name={activeTab === 'library' ? 'library' : 'library-outline'}
                size={22}
                color={activeTab === 'library' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'library' && { color: Colors.primary, fontWeight: '700' },
                ]}
              >
                Tủ Sách
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navTab}
              onPress={() => setActiveTab('queue')}
              accessibilityLabel="Hàng đợi"
            >
              <Ionicons
                name={activeTab === 'queue' ? 'cloud-upload' : 'cloud-upload-outline'}
                size={22}
                color={activeTab === 'queue' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'queue' && { color: Colors.primary, fontWeight: '700' },
                ]}
              >
                Hàng Đợi
              </Text>
            </TouchableOpacity>
          </View>
        )}
          </View>{/* mainColumnInner */}
        </View>{/* mainColumn */}
      </View>

      {/* Full Player Modal */}
      <FullPlayerModal
        visible={isFullPlayerVisible}
        book={currentBook}
        chapter={currentChapter}
        isPlaying={isPlaying}
        positionMs={positionMs}
        durationMs={durationMs}
        speed={speed}
        currentVoice={currentVoice}
        sleepTimerMinutes={sleepTimerMinutes}
        sentences={sentences}
        currentSentenceIndex={currentSentenceIndex}
        onSeekToSentence={handleSeekToSentence}
        bgmVolume={bgmVolume}
        onChangeBgmVolume={handleChangeBgmVolume}
        bgmEnabled={bgmEnabled}
        onToggleBgm={handleToggleBgm}
        onClose={() => setIsFullPlayerVisible(false)}
        onPlayPause={() => handleTogglePlay()}
        onNextChapter={handleNextChapter}
        onPrevChapter={handlePrevChapter}
        onSeek={handleSeek}
        onChangeSpeed={handleChangeSpeed}
        onOpenVoiceSelector={() => setIsVoiceSelectorVisible(true)}
        onOpenChapterList={openChapterList}
        onOpenSleepTimer={() => setIsSleepTimerVisible(true)}
        onOpenBatchQueue={() => setIsBatchQueueVisible(true)}
      />

      {/* Batch Queue Modal */}
      <BatchQueueModal
        visible={isBatchQueueVisible}
        books={books}
        onClose={() => setIsBatchQueueVisible(false)}
        onBatchBook={handleBatchBook}
      />

      {/* Chapter List Modal */}
      <ChapterListModal
        visible={isChapterListVisible}
        book={currentBook}
        currentChapter={currentChapter}
        readyChapterIds={chapterAudioState.ready}
        pendingChapterIds={chapterAudioState.pending}
        onClose={() => setIsChapterListVisible(false)}
        onSelectChapter={handleSelectChapter}
      />

      {/* Audio Storage & Offline Manager Modal */}
      <VoiceSelectorModal
        visible={isVoiceSelectorVisible}
        onClose={() => setIsVoiceSelectorVisible(false)}
      />

      {/* Sleep Timer Modal */}
      <SleepTimerModal
        visible={isSleepTimerVisible}
        activeMinutes={sleepTimerMinutes}
        onClose={() => setIsSleepTimerVisible(false)}
        onSetTimer={handleSetSleepTimer}
      />

      {/* URL / File Import Modal */}
      <UrlImportModal
        visible={isImportModalVisible}
        onClose={() => setIsImportModalVisible(false)}
        onBookImported={handleBookImported}
      />

      {/* Audio Choice Modal khi chương chưa có audio trên Drive */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appContainerWide: {
    flexDirection: 'row',
  },
  mainColumn: {
    flex: 1,
    height: '100%',
    backgroundColor: Colors.background,
    overflow: 'hidden',
  },
  mainColumnInner: {
    flex: 1,
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebar: {
    width: 240,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingTop: 24,
    paddingHorizontal: 12,
  },
  sidebarTablet: {
    width: 200,
    paddingHorizontal: 8,
  },
  miniPlayerBox: {
    width: '100%',
  },
  miniPlayerBoxWide: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sidebarLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  sidebarLogoText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginLeft: 8,
  },
  sidebarTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  sidebarTabActive: {
    backgroundColor: Colors.background,
  },
  sidebarLabel: {
    fontSize: 15,
    color: Colors.textMuted,
    marginLeft: 12,
  },
  screenContainer: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 60,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: Platform.OS === 'ios' ? 10 : 0,
  },
  navTab: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  navLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
});
