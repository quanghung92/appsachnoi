import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { Colors } from '../theme/colors';
import { Book, Chapter, VoiceOption } from '../types';

interface FullPlayerModalProps {
  visible: boolean;
  book: Book | null;
  chapter: Chapter | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
  currentVoice: VoiceOption;
  sleepTimerMinutes: number | null;
  sentences?: string[];
  currentSentenceIndex?: number;
  onClose: () => void;
  onPlayPause: () => void;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onSeek: (value: number) => void;
  onSeekToSentence?: (index: number) => void;
  onChangeSpeed: () => void;
  onOpenVoiceSelector: () => void;
  onOpenChapterList: () => void;
  onOpenSleepTimer: () => void;
  onOpenBatchQueue: () => void;
  bgmVolume?: number;
  onChangeBgmVolume?: (val: number) => void;
  bgmEnabled?: boolean;
  onToggleBgm?: () => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({
  visible,
  book,
  chapter,
  isPlaying,
  positionMs,
  durationMs,
  speed,
  currentVoice,
  sleepTimerMinutes,
  sentences = [],
  currentSentenceIndex = 0,
  onClose,
  onPlayPause,
  onNextChapter,
  onPrevChapter,
  onSeek,
  onSeekToSentence,
  onChangeSpeed,
  onOpenVoiceSelector,
  onOpenChapterList,
  onOpenSleepTimer,
  onOpenBatchQueue,
  bgmVolume = 0.35,
  onChangeBgmVolume,
  bgmEnabled = false,
  onToggleBgm,
}) => {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 768;
  const artworkSize = Math.min(width * 0.68, height * 0.35, 270);

  const [showTextReader, setShowTextReader] = useState<boolean>(false);
  const [showBgmControls, setShowBgmControls] = useState<boolean>(false);

  const flatListRef = useRef<FlatList<any>>(null);
  const userScrollingRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<any>(null);

  // Danh sách câu: lấy từ server/ttsService nếu có, hoặc tự tách từ chapter.content
  const sentencesList = useMemo(() => {
    if (sentences && sentences.length > 0) return sentences;
    if (!chapter?.content) return [];
    const normalized = chapter.content.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const raw = normalized.match(/[^.!?…\n]+[.!?…\n]+|[^.!?…\n]+$/g) || [normalized];
    return raw.map(s => s.trim()).filter(Boolean);
  }, [sentences, chapter?.id, chapter?.content]);

  // Auto-scroll thông minh tới câu đang đọc (giữ câu ở 1/3 tầm mắt)
  useEffect(() => {
    if (
      showTextReader &&
      !userScrollingRef.current &&
      currentSentenceIndex >= 0 &&
      currentSentenceIndex < sentencesList.length
    ) {
      try {
        flatListRef.current?.scrollToIndex({
          index: currentSentenceIndex,
          viewPosition: 0.3,
          animated: true,
        });
      } catch {}
    }
  }, [currentSentenceIndex, showTextReader, sentencesList.length]);

  if (!book || !chapter) return null;

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSentencePress = (index: number) => {
    if (onSeekToSentence) {
      onSeekToSentence(index);
    }
  };

  return (
    <Modal visible={visible} animationType={isWide ? 'fade' : 'slide'} transparent={isWide}>
      <View style={[styles.container, isWide && styles.containerWide]}>
        <View style={[styles.dialogCard, isWide && styles.dialogCardWide]}>
          {/* Top bar */}
          <View style={[styles.topBar, isWide && styles.topBarWide]}>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="Thu nhỏ">
              <Ionicons name="chevron-down" size={28} color={Colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.topTitleBox}>
              <Text style={styles.topSubtitle}>ĐANG PHÁT AUDIO</Text>
              <Text style={styles.topTitle} numberOfLines={1}>
                {book.category}
              </Text>
            </View>

            <View style={styles.topRightActions}>
              {/* Nút bật/tắt Nhạc Nền (BGM) */}
              <TouchableOpacity
                onPress={() => setShowBgmControls(!showBgmControls)}
                style={[styles.iconBtn, bgmEnabled && styles.activeBgmBtn, { marginRight: 8 }]}
                accessibilityLabel="Điều chỉnh nhạc nền"
              >
                <Ionicons
                  name="musical-notes"
                  size={20}
                  color={bgmEnabled ? Colors.primary : Colors.textMuted}
                />
              </TouchableOpacity>

              {/* Nút chuyển chế độ Đọc Chữ (Read-Along) */}
              <TouchableOpacity
                onPress={() => setShowTextReader(!showTextReader)}
                style={[styles.iconBtn, showTextReader && styles.activeReaderBtn]}
                accessibilityLabel="Đọc văn bản"
              >
                <Ionicons
                  name={showTextReader ? 'document-text' : 'document-text-outline'}
                  size={22}
                  color={showTextReader ? Colors.primary : Colors.textPrimary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Hộp điều khiển Nhạc Nền (BGM Controls Panel) */}
          {showBgmControls && (
            <View style={styles.bgmPanel}>
              <View style={styles.bgmRow}>
                <TouchableOpacity
                  style={[styles.bgmToggleBtn, bgmEnabled && styles.bgmToggleBtnActive]}
                  onPress={onToggleBgm}
                >
                  <Ionicons
                    name={bgmEnabled ? 'volume-high' : 'volume-mute'}
                    size={18}
                    color={bgmEnabled ? Colors.background : Colors.textMuted}
                  />
                  <Text style={[styles.bgmToggleText, bgmEnabled && styles.bgmToggleTextActive]}>
                    {bgmEnabled ? 'Nhạc Nền Đang Bật' : 'Nhạc Nền Đang Tắt'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.bgmDuckingBadge}>Né giọng 15%</Text>
              </View>

              {bgmEnabled && onChangeBgmVolume && (
                <View style={styles.bgmSliderRow}>
                  <Ionicons name="musical-note" size={16} color={Colors.textMuted} />
                  <Slider
                    style={styles.bgmSlider}
                    minimumValue={0}
                    maximumValue={1}
                    value={bgmVolume}
                    onValueChange={onChangeBgmVolume}
                    minimumTrackTintColor={Colors.primary}
                    maximumTrackTintColor={Colors.playerSliderTrack}
                    thumbTintColor={Colors.primary}
                  />
                  <Text style={styles.bgmVolumeText}>{Math.round(bgmVolume * 100)}%</Text>
                </View>
              )}
            </View>
          )}

          {showTextReader ? (
            /* BƯỚC 3: Synchronized Read-Along Mode (Highlight & Auto-Scroll & Tap-to-Seek) */
            <View style={styles.readerContainer}>
              <View style={styles.readerHeader}>
                <TouchableOpacity
                  onPress={onOpenChapterList}
                  style={styles.readerTocBtn}
                  accessibilityLabel="Mục lục"
                >
                  <Ionicons name="list" size={16} color={Colors.primary} />
                  <Text style={styles.readerTocText}>Mục lục</Text>
                </TouchableOpacity>
                <View style={{ flex: 1, marginHorizontal: 8 }}>
                  <Text style={styles.readerTitle} numberOfLines={1}>{chapter.title}</Text>
                  <Text style={styles.readerSubtitle} numberOfLines={1}>{book.title}</Text>
                </View>
                {sentencesList.length > 0 && (
                  <View style={styles.sentenceCounterBadge}>
                    <Text style={styles.sentenceCounterText}>
                      Câu {Math.min(currentSentenceIndex + 1, sentencesList.length)}/{sentencesList.length}
                    </Text>
                  </View>
                )}
              </View>

              <FlatList
                ref={flatListRef}
                data={sentencesList}
                keyExtractor={(_, index) => `sentence_${index}`}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={styles.readerListContent}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    flatListRef.current?.scrollToIndex({
                      index: info.index,
                      viewPosition: 0.3,
                      animated: true,
                    });
                  }, 200);
                }}
                onScrollBeginDrag={() => {
                  userScrollingRef.current = true;
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                  scrollTimeoutRef.current = setTimeout(() => {
                    userScrollingRef.current = false;
                  }, 4500);
                }}
                renderItem={({ item, index }) => {
                  const isCurrent = index === currentSentenceIndex;
                  const isPast = index < currentSentenceIndex;

                  return (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => handleSentencePress(index)}
                      style={[
                        styles.sentenceItem,
                        isCurrent && styles.activeSentenceItem,
                      ]}
                    >
                      {isCurrent && (
                        <View style={styles.activeSpeakerDot}>
                          <Ionicons name="volume-medium" size={15} color={Colors.primary} />
                        </View>
                      )}
                      <Text
                        style={[
                          styles.sentenceText,
                          isCurrent && styles.activeSentenceText,
                          isPast && styles.pastSentenceText,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          ) : (
            /* Standard Player Cover Mode */
            <View style={styles.mainContent}>
              {/* Cover Artwork */}
              <View style={[styles.artworkContainer, { width: artworkSize, height: artworkSize * 1.2 }]}>
                <Image source={{ uri: book.coverUrl }} style={styles.artwork} resizeMode="cover" />
                {isPlaying && (
                  <View style={styles.pulsingGlow}>
                    <View style={styles.soundWaves}>
                      <Ionicons name="stats-chart" size={24} color={Colors.primary} />
                    </View>
                  </View>
                )}
              </View>

              {/* Book & Chapter Details */}
              <View style={styles.metaContainer}>
                <Text style={styles.bookTitle} numberOfLines={2}>
                  {book.title}
                </Text>
                <Text style={styles.chapterTitle} numberOfLines={1}>
                  {chapter.title}
                </Text>
                <Text style={styles.authorName}>{book.author}</Text>
              </View>
            </View>
          )}

          {/* Playback Progress Slider */}
          <View style={styles.progressSection}>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(durationMs > 0 ? durationMs : 60000, positionMs, 1000)}
              value={positionMs}
              onSlidingComplete={onSeek}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.playerSliderTrack}
              thumbTintColor={Colors.primary}
            />
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
              <Text style={styles.timeText}>{formatTime(Math.max(durationMs > 0 ? durationMs : 60000, positionMs))}</Text>
            </View>
          </View>

          {/* Primary Controls */}
          <View style={styles.controlsSection}>
            {/* Rewind 15s */}
            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => onSeek(Math.max(0, positionMs - 15000))}
              accessibilityLabel="Tua lại 15 giây"
            >
              <Ionicons name="refresh-outline" size={22} color={Colors.textLight} />
              <Text style={styles.seekBtnText}>15</Text>
            </TouchableOpacity>

            {/* Previous Chapter */}
            <TouchableOpacity
              style={styles.secondaryControlBtn}
              onPress={onPrevChapter}
              accessibilityLabel="Chương trước"
            >
              <Ionicons name="play-skip-back" size={26} color={Colors.textPrimary} />
            </TouchableOpacity>

            {/* Master Play / Pause Button */}
            <TouchableOpacity
              style={styles.masterPlayBtn}
              onPress={onPlayPause}
              activeOpacity={0.85}
              accessibilityLabel={isPlaying ? 'Tạm dừng' : 'Phát tiếp'}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={36}
                color={Colors.background}
                style={!isPlaying ? { marginLeft: 3 } : null}
              />
            </TouchableOpacity>

            {/* Next Chapter */}
            <TouchableOpacity
              style={styles.secondaryControlBtn}
              onPress={onNextChapter}
              accessibilityLabel="Chương sau"
            >
              <Ionicons name="play-skip-forward" size={26} color={Colors.textPrimary} />
            </TouchableOpacity>

            {/* Forward 15s */}
            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => onSeek(Math.min(durationMs, positionMs + 15000))}
              accessibilityLabel="Tua tới 15 giây"
            >
              <Ionicons name="refresh" size={22} color={Colors.textLight} style={{ transform: [{ scaleX: -1 }] }} />
              <Text style={styles.seekBtnText}>15</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Auxiliary Actions */}
          <View style={styles.bottomBar}>
            {/* Speed */}
            <TouchableOpacity style={styles.bottomAction} onPress={onChangeSpeed}>
              <Text style={styles.speedText}>{speed}x</Text>
              <Text style={styles.bottomActionLabel}>Tốc độ</Text>
            </TouchableOpacity>

            {/* Audio Storage / Cache */}
            <TouchableOpacity style={styles.bottomAction} onPress={onOpenVoiceSelector}>
              <Ionicons name="cloud-download-outline" size={20} color={Colors.secondary} />
              <Text style={styles.bottomActionLabel}>Bộ nhớ</Text>
            </TouchableOpacity>

            {/* Sleep Timer */}
            <TouchableOpacity style={styles.bottomAction} onPress={onOpenSleepTimer}>
              <Ionicons
                name="moon"
                size={20}
                color={sleepTimerMinutes ? Colors.primary : Colors.textSecondary}
              />
              <Text style={styles.bottomActionLabel}>
                {sleepTimerMinutes ? `${sleepTimerMinutes}m` : 'Hẹn giờ'}
              </Text>
            </TouchableOpacity>

            {/* Chapter List */}
            <TouchableOpacity style={styles.bottomAction} onPress={onOpenChapterList}>
              <Ionicons name="list" size={20} color={Colors.textSecondary} />
              <Text style={styles.bottomActionLabel}>Mục lục</Text>
            </TouchableOpacity>

            {/* Batch Queue */}
            <TouchableOpacity style={styles.bottomAction} onPress={onOpenBatchQueue}>
              <Ionicons name="cloud-upload-outline" size={20} color={Colors.textSecondary} />
              <Text style={styles.bottomActionLabel}>Hàng đợi</Text>
            </TouchableOpacity>
          </View>
        </View>{/* dialogCard */}
      </View>{/* container */}
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  containerWide: {
    backgroundColor: 'rgba(5, 7, 15, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    flex: 1,
    width: '100%',
    backgroundColor: Colors.background,
    justifyContent: 'space-between',
    paddingBottom: 28,
  },
  dialogCardWide: {
    maxWidth: 520,
    maxHeight: '92%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 20,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 16,
  },
  topBarWide: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  topTitleBox: {
    alignItems: 'center',
  },
  topSubtitle: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '700',
    letterSpacing: 1,
  },
  topTitle: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '600',
    marginTop: 2,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  activeReaderBtn: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  artworkContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.surfaceElevated,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  pulsingGlow: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(11, 15, 25, 0.8)',
    borderRadius: 14,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.4)',
  },
  soundWaves: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaContainer: {
    alignItems: 'center',
    marginTop: 24,
    width: '100%',
  },
  bookTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  chapterTitle: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  authorName: {
    fontSize: 14,
    color: Colors.textMuted,
    fontWeight: '500',
    marginTop: 4,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeBgmBtn: {
    backgroundColor: 'rgba(6, 214, 160, 0.2)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  bgmPanel: {
    backgroundColor: Colors.surfaceElevated,
    marginHorizontal: 20,
    marginTop: -4,
    marginBottom: 8,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  bgmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bgmToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  bgmToggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  bgmToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 6,
  },
  bgmToggleTextActive: {
    color: Colors.background,
  },
  bgmDuckingBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  bgmSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  bgmSlider: {
    flex: 1,
    height: 30,
    marginHorizontal: 8,
  },
  bgmVolumeText: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
  },
  readerContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 10,
  },
  readerTocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  readerTocText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
    marginLeft: 4,
  },
  readerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.primary,
  },
  readerSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  sentenceCounterBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginLeft: 8,
  },
  sentenceCounterText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  readerListContent: {
    paddingBottom: 30,
  },
  sentenceItem: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 3,
    position: 'relative',
  },
  activeSentenceItem: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    borderLeftWidth: 3.5,
    borderLeftColor: Colors.primary,
    paddingLeft: 34,
  },
  activeSpeakerDot: {
    position: 'absolute',
    left: 10,
    top: 13,
  },
  sentenceText: {
    fontSize: 16,
    color: Colors.textLight,
    lineHeight: 27,
    letterSpacing: 0.3,
  },
  activeSentenceText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16.5,
  },
  pastSentenceText: {
    color: Colors.textMuted,
    opacity: 0.7,
  },
  progressSection: {
    paddingHorizontal: 28,
    marginTop: 10,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  timeText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  controlsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    marginVertical: 12,
  },
  seekBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    position: 'relative',
  },
  seekBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.textLight,
    position: 'absolute',
    top: 15,
  },
  secondaryControlBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterPlayBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  bottomAction: {
    alignItems: 'center',
    minWidth: 64,
  },
  speedText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  bottomActionLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    fontWeight: '500',
  },
});
