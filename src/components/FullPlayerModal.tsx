import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
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
  onClose: () => void;
  onPlayPause: () => void;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onSeek: (value: number) => void;
  onChangeSpeed: () => void;
  onOpenVoiceSelector: () => void;
  onOpenChapterList: () => void;
  onOpenSleepTimer: () => void;
}

const { width } = Dimensions.get('window');

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
  onClose,
  onPlayPause,
  onNextChapter,
  onPrevChapter,
  onSeek,
  onChangeSpeed,
  onOpenVoiceSelector,
  onOpenChapterList,
  onOpenSleepTimer,
}) => {
  const [showTextReader, setShowTextReader] = useState<boolean>(false);

  if (!book || !chapter) return null;

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="Thu nhỏ">
            <Ionicons name="chevron-down" size={28} color={Colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.topTitleBox}>
            <Text style={styles.topSubtitle}>ĐANG PHÁT AUDIO</Text>
            <Text style={styles.topTitle} numberOfLines={1}>
              {book.category}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setShowTextReader(!showTextReader)}
            style={[styles.iconBtn, showTextReader && styles.activeReaderBtn]}
            accessibilityLabel="Đọc văn bản"
          >
            <Ionicons
              name={showTextReader ? 'document-text' : 'document-text-outline'}
              size={24}
              color={showTextReader ? Colors.primary : Colors.textPrimary}
            />
          </TouchableOpacity>
        </View>

        {showTextReader ? (
          /* Text Reading Mode */
          <View style={styles.readerContainer}>
            <View style={styles.readerHeader}>
              <Text style={styles.readerTitle}>{chapter.title}</Text>
              <Text style={styles.readerSubtitle}>{book.title}</Text>
            </View>
            <ScrollView style={styles.readerScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.readerContent}>{chapter.content}</Text>
            </ScrollView>
          </View>
        ) : (
          /* Standard Player Cover Mode */
          <View style={styles.mainContent}>
            {/* Cover Artwork */}
            <View style={styles.artworkContainer}>
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
            maximumValue={Math.max(durationMs, 1000)}
            value={positionMs}
            onSlidingComplete={onSeek}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.playerSliderTrack}
            thumbTintColor={Colors.primary}
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
            <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
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

          {/* Voice Switcher */}
          <TouchableOpacity style={styles.bottomAction} onPress={onOpenVoiceSelector}>
            <Ionicons name="mic" size={20} color={Colors.secondary} />
            <Text style={styles.bottomActionLabel}>
              {currentVoice.gender === 'female' ? 'Hoài My' : 'Nam Minh'}
            </Text>
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
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'space-between',
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 16,
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
    width: width * 0.72,
    height: width * 0.95,
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
  readerContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  readerHeader: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
  },
  readerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  readerSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
  },
  readerScroll: {
    flex: 1,
  },
  readerContent: {
    fontSize: 16,
    color: Colors.textLight,
    lineHeight: 28,
    letterSpacing: 0.3,
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
