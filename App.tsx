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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from './src/theme/colors';
import { Book, Chapter, VoiceOption } from './src/types';
import { DRIVE_BOOKS } from './src/data/books';
import { WEB_NOVELS } from './src/data/novels';
import { ttsService, VIETNAMESE_VOICES } from './src/services/ttsService';
import { batchService, BatchEngine } from './src/services/batchService';
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

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'library'>('home');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tất Cả');

  // Book Data
  const [books, setBooks] = useState<Book[]>(DRIVE_BOOKS);
  const [novels, setNovels] = useState<Book[]>(WEB_NOVELS);
  const [recentBooks, setRecentBooks] = useState<Book[]>([DRIVE_BOOKS[0], WEB_NOVELS[0]]);
  const [savedBooks, setSavedBooks] = useState<Book[]>([DRIVE_BOOKS[1], WEB_NOVELS[1]]);

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

  // Trạng thái audio từng chương trên batch server (đồng bộ hiển thị với server)
  const [chapterAudioState, setChapterAudioState] = useState<{
    ready: Set<string>;
    pending: Set<string>;
  }>({ ready: new Set<string>(), pending: new Set<string>() });

  // Nạp sách đã lưu + tiến độ nghe khi mở app
  useEffect(() => {
    (async () => {
      try {
        const saved = await storageService.getSavedBooks();
        if (saved.length > 0) {
          const webNovels = saved.filter(b => b.type === 'web_novel');
          const others = saved.filter(b => b.type !== 'web_novel');
          if (webNovels.length > 0) setNovels(prev => [...webNovels, ...prev]);
          if (others.length > 0) {
            setBooks(prev => [...others, ...prev]);
            setSavedBooks(prev => [...others, ...prev]);
          }
        }
        const progress = await storageService.getLastProgress();
        setLastProgress(progress);
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

    return () => {
      unsubscribe();
    };
  }, []);

  // Handle Play/Pause
  const handleTogglePlay = async (targetBook?: Book) => {
    const bookToPlay = targetBook || currentBook;
    if (!bookToPlay) return;

    // If tapping another book
    if (bookToPlay.id !== currentBook?.id) {
      setCurrentBook(bookToPlay);
      const firstChapter = bookToPlay.chapters[0];
      setCurrentChapter(firstChapter);
      await startReading(firstChapter.content, bookToPlay, firstChapter);
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
        await startReading(currentChapter.content, bookToPlay, currentChapter);
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
      const localUri = await batchService.getChapterAudioFile(book.id, chapter.id);
      if (!localUri) return false;

      setIsPlaying(true);
      ttsService.setNowPlaying(book.title, chapter.title);
      await ttsService.playChapterAudio(
        localUri,
        () => {
          handleNextChapter();
        },
        (err) => {
          console.log('[App] Chapter audio error:', err);
          setIsPlaying(false);
        },
        (posMs) => {
          // Lưu tiến độ theo mili-giây trong chương (throttle ~5s trong service gọi,
          // ở đây lưu mỗi lần callback để đơn giản vì service đã throttle 2s).
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
        startMs
      );
      return true;
    } catch (e) {
      console.log('[App] tryPlayChapterAudio failed:', e);
      return false;
    }
  };

  /**
   * Đẩy chương hiện tại + 2 chương tiếp theo vào hàng đợi batch (cuối hàng).
   * Chỉ chạy khi bật "Tự động batch sách đang nghe". Server tự lấy nội dung
   * (cào URL truyện / tra text sách trong Volume), TRUYỆN -> Gemini, SÁCH -> Kokoro.
   */
  const enqueueChapterForBatch = (book: Book, chapter: Chapter) => {
    (async () => {
      try {
        if (!batchService.isConfigured()) return;
        if (!(await batchService.getAutoBatch())) return;
        // Server batch chỉ chạy Kokoro (Gemini đã tắt từ đêm 11/10) — mọi loại nội dung đều dùng Kokoro.
        const engine: BatchEngine = 'kokoro';
        const voice = await getKokoroVoiceForBook(book.id);
        const idx = book.chapters.findIndex((c) => c.id === chapter.id);
        const items: {
          book_id: string; chapter_id: string; title: string;
          url?: string; engine: BatchEngine; voice?: string;
        }[] = [];
        for (let i = Math.max(0, idx); i < Math.min(idx + 3, book.chapters.length); i++) {
          const ch = book.chapters[i];
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
        }
      } catch (e) {
        console.log('[App] enqueue batch error:', e);
      }
    })();
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
   * User chọn batch 1 cuốn sách/truyện cụ thể: đẩy 10 chương tiếp theo
   * (từ vị trí đang nghe, bỏ qua chương đã có audio / đang chờ) lên ĐẦU hàng đợi.
   */
  const handleBatchBook = async (book: Book) => {
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
      const items: {
        book_id: string; chapter_id: string; title: string;
        url?: string; engine: BatchEngine; voice?: string;
      }[] = [];
      for (let i = startIdx; i < book.chapters.length && items.length < 10; i++) {
        const ch = book.chapters[i];
        if (ready.has(ch.id) || pending.has(ch.id)) continue;
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

  const startReading = async (text: string, book?: Book, chapter?: Chapter, startSentenceIndex: number = 0) => {
    // Kiến trúc batch: app vào THẲNG Drive lấy MP3 chương, không qua Modal realtime.
    if (book && chapter && batchService.isConfigured() && startSentenceIndex <= 0) {
      const played = await tryPlayChapterAudio(book, chapter, 0);
      if (played) return;
      // Chưa có audio -> đẩy vào hàng đợi + báo rõ. KHÔNG đọc tạm từng câu.
      enqueueChapterForBatch(book, chapter);
      setIsPlaying(false);
      Alert.alert(
        'Chưa có audio',
        `"${chapter.title}" chưa được gen. Đã xếp vào hàng đợi — server tự gen lúc 3h sáng.`,
        [
          { text: 'Để đêm tự gen', style: 'cancel' },
          {
            text: 'Gen ngay',
            onPress: async () => {
              const ok = await batchService.triggerNow(5);
              Alert.alert(
                ok ? 'Đã kích hoạt' : 'Lỗi',
                ok
                  ? 'Server đang gen, quay lại sau vài phút rồi mở lại chương này.'
                  : 'Không gọi được server batch.'
              );
            },
          },
        ]
      );
      return;
    }

    // Batch chưa cấu hình: giữ luồng Kokoro realtime cũ (giai đoạn chuyển đổi).
    let readingText = text;
    if (book && chapter) {
      try {
        const fullContent = await crawlerService.ensureChapterContent(book, chapter);
        if (fullContent && fullContent.length > readingText.length) {
          readingText = fullContent;
          chapter.content = fullContent;
        }
      } catch (e) {
        console.log('[App] Error ensuring full chapter content:', e);
      }
    }

    setIsPlaying(true);
    if (book) {
      ttsService.setNowPlaying(book.title, chapter?.title || book.author);
    }
    await ttsService.speak(
      readingText,
      // onFinish: Auto-advance to next chapter!
      () => {
        handleNextChapter();
      },
      (err) => {
        console.log('TTS Error:', err);
        setIsPlaying(false);
      },
      // onSentence: ghi nhớ tiến độ từng câu (PLAN B2)
      (sentenceIndex, totalSentences) => {
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
      startSentenceIndex
    );
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
        await startReading(chapter.content, book, chapter, 0);
      }
    } else {
      await startReading(
        chapter.content,
        book,
        chapter,
        lastProgress.sentenceIndex
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
      } catch {}
    } else {
      setChapterAudioState({ ready: new Set<string>(), pending: new Set<string>() });
    }
  };

  /** Xóa sách khỏi tủ (kèm xác nhận, PLAN B2). */
  const handleDeleteBook = (book: Book) => {
    Alert.alert(
      'Xóa sách',
      `Xóa "${book.title}" khỏi tủ sách? Toàn bộ nội dung và tiến độ nghe sẽ bị xóa khỏi máy.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            await storageService.deleteBook(book.id);
            // Đồng bộ: xóa luôn hàng đợi + audio trên batch server / Drive
            batchService.removeBook(book.id).catch(() => {});
            setBooks(prev => prev.filter(b => b.id !== book.id));
            setNovels(prev => prev.filter(b => b.id !== book.id));
            setSavedBooks(prev => prev.filter(b => b.id !== book.id));
            setRecentBooks(prev => prev.filter(b => b.id !== book.id));
            if (currentBook?.id === book.id) {
              ttsService.stop();
              setCurrentBook(null);
              setCurrentChapter(null);
              setIsPlaying(false);
            }
            const progress = await storageService.getLastProgress();
            setLastProgress(progress);
          },
        },
      ]
    );
  };

  const handleSelectBook = (book: Book, chapter?: Chapter) => {
    setCurrentBook(book);
    const targetChapter = chapter || book.chapters[0];
    setCurrentChapter(targetChapter);
    setIsFullPlayerVisible(true);
    addToRecent(book);
  };

  const handleSelectChapter = (chapter: Chapter) => {
    setCurrentChapter(chapter);
    if (currentBook) {
      startReading(chapter.content, currentBook, chapter);
    }
  };

  const handleNextChapter = () => {
    if (!currentBook || !currentChapter) return;
    const currentIndex = currentBook.chapters.findIndex((c) => c.id === currentChapter.id);
    if (currentIndex >= 0 && currentIndex < currentBook.chapters.length - 1) {
      const next = currentBook.chapters[currentIndex + 1];
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
      return [book, ...filtered].slice(0, 10);
    });
  };

  const allBooksList = [...books, ...novels];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.appContainer}>
        {/* Top Header */}
        <Header
          currentVoice={currentVoice}
          onOpenVoiceSelector={() => setIsVoiceSelectorVisible(true)}
          onOpenImportModal={() => setIsImportModalVisible(true)}
          sleepTimerMinutes={sleepTimerMinutes}
          onOpenSleepTimer={() => setIsSleepTimerVisible(true)}
        />

        {/* Screen Switcher */}
        <View style={styles.screenContainer}>
          {activeTab === 'home' && (
            <HomeScreen
              books={books}
              novels={novels}
              currentBook={currentBook}
              isPlaying={isPlaying}
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
            />
          )}
        </View>

        {/* Floating Mini Player */}
        {currentBook && currentChapter && (
          <MiniPlayer
            book={currentBook}
            chapter={currentChapter}
            isPlaying={isPlaying}
            positionMs={positionMs}
            durationMs={durationMs}
            onPress={() => setIsFullPlayerVisible(true)}
            onPlayPause={() => handleTogglePlay()}
            onNextChapter={handleNextChapter}
          />
        )}

        {/* Bottom Navigation Bar */}
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
        </View>
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

      {/* Voice Selector Modal */}
      <VoiceSelectorModal
        visible={isVoiceSelectorVisible}
        selectedVoice={currentVoice}
        onClose={() => setIsVoiceSelectorVisible(false)}
        onSelectVoice={handleSelectVoice}
        onTestVoice={handleTestVoice}
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
