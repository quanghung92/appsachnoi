import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';

interface MiniPlayerProps {
  book: Book;
  chapter: Chapter;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  onPress: () => void;
  onPlayPause: () => void;
  onNextChapter: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  book,
  chapter,
  isPlaying,
  positionMs,
  durationMs,
  onPress,
  onPlayPause,
  onNextChapter,
}) => {
  const progressPercent = durationMs > 0 ? Math.min((positionMs / durationMs) * 100, 100) : 0;

  return (
    <View style={styles.wrapper}>
      {/* Top thin progress line */}
      <View style={styles.progressBarBackground}>
        <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
      </View>

      <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.9}>
        <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {book.title}
          </Text>
          <Text style={styles.chapterTitle} numberOfLines={1}>
            {chapter.title}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={onPlayPause}
            accessibilityLabel={isPlaying ? 'Tạm dừng' : 'Phát tiếp'}
          >
            <Ionicons
              name={isPlaying ? 'pause-circle' : 'play-circle'}
              size={36}
              color={Colors.primary}
            />
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
  progressBarBackground: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    height: 62,
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
  chapterTitle: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlBtn: {
    padding: 4,
  },
});
