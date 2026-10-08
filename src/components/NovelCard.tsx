import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book } from '../types';

interface NovelCardProps {
  novel: Book;
  isPlaying: boolean;
  onPress: () => void;
  onPlayPress: () => void;
}

export const NovelCard: React.FC<NovelCardProps> = ({
  novel,
  isPlaying,
  onPress,
  onPlayPress,
}) => {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.85}>
      <Image source={{ uri: novel.coverUrl }} style={styles.cover} resizeMode="cover" />

      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{novel.category}</Text>
          </View>
          <View style={styles.chapterBadge}>
            <Ionicons name="layers-outline" size={12} color={Colors.secondary} />
            <Text style={styles.chapterCountText}>{novel.chapters.length} chương</Text>
          </View>
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {novel.title}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {novel.author}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {novel.description}
        </Text>

        <View style={styles.actionRow}>
          <View style={styles.ratingBox}>
            <Ionicons name="star" size={13} color={Colors.accentWarm} />
            <Text style={styles.ratingText}>{novel.rating}</Text>
          </View>

          <TouchableOpacity
            style={[styles.playBtn, isPlaying && styles.playingBtn]}
            onPress={onPlayPress}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={14}
              color={isPlaying ? Colors.primary : Colors.background}
            />
            <Text style={[styles.playBtnText, isPlaying && { color: Colors.primary }]}>
              {isPlaying ? 'Đang phát' : 'Nghe ngay'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceCard,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cover: {
    width: 85,
    height: 120,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(6, 214, 160, 0.3)',
  },
  categoryText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  chapterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chapterCountText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  author: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  desc: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  ratingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    color: Colors.textLight,
    fontWeight: '700',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  playingBtn: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  playBtnText: {
    color: Colors.background,
    fontSize: 11,
    fontWeight: '700',
  },
});
