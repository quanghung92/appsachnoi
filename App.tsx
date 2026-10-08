import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from './src/theme/colors';
import { Book, Chapter, VoiceOption } from './src/types';
import { DRIVE_BOOKS } from './src/data/books';
import { WEB_NOVELS } from './src/data/novels';
import { ttsService, VIETNAMESE_VOICES } from './src/services/ttsService';

// Components
import { Header } from './src/components/Header';
import { MiniPlayer } from './src/components/MiniPlayer';
import { FullPlayerModal } from './src/components/FullPlayerModal';
import { ChapterListModal } from './src/components/ChapterListModal';
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
  const [isVoiceSelectorVisible, setIsVoiceSelectorVisible] = useState<boolean>(false);
  const [isSleepTimerVisible, setIsSleepTimerVisible] = useState<boolean>(false);
  const [isImportModalVisible, setIsImportModalVisible] = useState<boolean>(false);

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
      await startReading(firstChapter.content);
      addToRecent(bookToPlay);
      return;
    }

    // Toggle same book
    if (isPlaying) {
      await ttsService.pause();
      setIsPlaying(false);
    } else {
      if (currentChapter) {
        await startReading(currentChapter.content);
      }
    }
  };

  const startReading = async (text: string) => {
    setIsPlaying(true);
    await ttsService.speak(
      text,
      // onFinish: Auto-advance to next chapter!
      () => {
        handleNextChapter();
      },
      (err) => {
        console.log('TTS Error:', err);
        setIsPlaying(false);
      }
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
    startReading(chapter.content);
  };

  const handleNextChapter = () => {
    if (!currentBook || !currentChapter) return;
    const currentIndex = currentBook.chapters.findIndex((c) => c.id === currentChapter.id);
    if (currentIndex >= 0 && currentIndex < currentBook.chapters.length - 1) {
      const next = currentBook.chapters[currentIndex + 1];
      setCurrentChapter(next);
      startReading(next.content);
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
      startReading(prev.content);
    }
  };

  const handleSeek = (ms: number) => {
    setPositionMs(ms);
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
    ttsService.setVoice(voice);
    ttsService.speak(voice.sampleText);
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

    if (playImmediately) {
      setCurrentBook(newBook);
      const chapter = newBook.chapters[0];
      setCurrentChapter(chapter);
      startReading(chapter.content);
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
              onSelectCategory={setSelectedCategory}
              onSelectBook={handleSelectBook}
              onTogglePlay={handleTogglePlay}
              onOpenImportModal={() => setIsImportModalVisible(true)}
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
        onOpenChapterList={() => setIsChapterListVisible(true)}
        onOpenSleepTimer={() => setIsSleepTimerVisible(true)}
      />

      {/* Chapter List Modal */}
      <ChapterListModal
        visible={isChapterListVisible}
        book={currentBook}
        currentChapter={currentChapter}
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
