import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';

interface MiniPlayerProps {
  book: Book;
  chapter: Chapter;
  isPlaying: boolean;
  isLoading?: boolean;
  positionMs: number;
  durationMs: number;
  onPress: () => void;
  onPlayPause: () => void;
  onNextChapter: () => void;
  onSeek?: (positionMs: number) => void;
}

const formatTime = (ms: number): string => {
  if (!ms || isNaN(ms) || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  book,
  chapter,
  isPlaying,
  isLoading = false,
  positionMs,
  durationMs,
  onPress,
  onPlayPause,
  onNextChapter,
  onSeek,
}) => {
  const [trackWidth, setTrackWidth] = React.useState<number>(0);
  const [isScrubbing, setIsScrubbing] = React.useState<boolean>(false);
  const [scrubPositionMs, setScrubPositionMs] = React.useState<number>(0);

  const validPos = !isNaN(positionMs) && positionMs > 0 ? positionMs : 0;
  const validDuration = Math.max(
    !isNaN(durationMs) && durationMs > 0 ? durationMs : 60000,
    validPos
  );

  const currentDisplayPos = isScrubbing ? scrubPositionMs : validPos;
  const progressPercent = validDuration > 0
    ? Math.min(Math.max((currentDisplayPos / validDuration) * 100, 0), 100)
    : 0;

  const calculateSeekMs = (locationX: number): number => {
    if (trackWidth <= 0 || validDuration <= 0) return 0;
    const clampedX = Math.max(0, Math.min(trackWidth, locationX));
    const ratio = clampedX / trackWidth;
    return Math.round(ratio * validDuration);
  };

  return (
    <View style={styles.wrapper}>
      {/* Top interactive progress seek bar */}
      <View
        style={styles.progressBarTouchArea}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) setTrackWidth(w);
        }}
        onStartShouldSetResponder={() => Boolean(onSeek)}
        onMoveShouldSetResponder={() => Boolean(onSeek)}
        onResponderGrant={(e: GestureResponderEvent) => {
          const locX = e.nativeEvent.locationX;
          const targetMs = calculateSeekMs(locX);
          setIsScrubbing(true);
          setScrubPositionMs(targetMs);
        }}
        onResponderMove={(e: GestureResponderEvent) => {
          const locX = e.nativeEvent.locationX;
          const targetMs = calculateSeekMs(locX);
          setScrubPositionMs(targetMs);
        }}
        onResponderRelease={(e: GestureResponderEvent) => {
          const locX = e.nativeEvent.locationX;
          const targetMs = calculateSeekMs(locX);
          setIsScrubbing(false);
          onSeek?.(targetMs);
        }}
        onResponderTerminate={() => {
          setIsScrubbing(false);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Thanh tua audio"
      >
        <View
          pointerEvents="none"
          style={[styles.progressBarBackground, isScrubbing && styles.progressBarBackgroundActive]}
        >
          <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          {isScrubbing && (
            <View style={[styles.scrubThumb, { left: `${progressPercent}%` }]} />
          )}
        </View>
      </View>

      <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.9}>
        <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {book.title}
          </Text>
          <View style={styles.subRow}>
            <Text style={styles.chapterTitle} numberOfLines={1}>
              {chapter.title}
            </Text>
            <Text style={styles.timeText}>
              {formatTime(currentDisplayPos)} / {formatTime(validDuration)}
            </Text>
          </View>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={onPlayPause}
            disabled={isLoading}
            accessibilityLabel={isLoading ? 'Đang tải audio' : isPlaying ? 'Tạm dừng' : 'Phát tiếp'}
          >
            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : (
              <Ionicons
                name={isPlaying ? 'pause-circle' : 'play-circle'}
                size={38}
                color={Colors.primary}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={onNextChapter}
            accessibilityLabel="Chương tiếp theo"
          >
            <Ionicons name="play-skip-forward" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  progressBarTouchArea: {
    height: 12,
    justifyContent: 'center',
    paddingVertical: 3,
    zIndex: 20,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', userSelect: 'none' } as any) : {}),
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: '100%',
    position: 'relative',
    borderRadius: 2,
    overflow: 'visible',
  },
  progressBarBackgroundActive: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 3,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  scrubThumb: {
    position: 'absolute',
    top: -3,
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 4,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    height: 64,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  info: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    gap: 8,
  },
  chapterTitle: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  timeText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlBtn: {
    padding: 4,
  },
  loadingBox: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
