import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book } from '../types';

interface BookCardProps {
  book: Book;
  isPlaying: boolean;
  onPress: () => void;
  onPlayPress: () => void;
}

export const BookCard: React.FC<BookCardProps> = ({
  book,
  isPlaying,
  onPress,
  onPlayPress,
}) => {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.coverWrapper}>
        <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />
        {/* Source badge */}
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>
            {book.type === 'drive_book' ? 'Google Drive' : book.type === 'web_novel' ? 'Truyện Chữ' : 'Tùy chỉnh'}
          </Text>
        </View>

        {/* Play Floating Action */}
        <TouchableOpacity
          style={[styles.playBtn, isPlaying && styles.playingBtn]}
          onPress={onPlayPress}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isPlaying ? Colors.primary : Colors.background}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {book.author}
        </Text>

        <View style={styles.footerRow}>
          <View style={styles.metaRow}>
            <Ionicons name="star" size={12} color={Colors.accentWarm} />
            <Text style={styles.ratingText}>{book.rating || '5.0'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="headset-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.listenText}>{book.listenCount || '10K'}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: 165,
    backgroundColor: Colors.surfaceCard,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  coverWrapper: {
    width: '100%',
    height: 200,
    position: 'relative',
    backgroundColor: Colors.surfaceElevated,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(11, 15, 25, 0.75)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  badgeText: {
    color: Colors.textLight,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  playBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  playingBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  info: {
    padding: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 18,
    marginBottom: 4,
  },
  author: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
    marginBottom: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '600',
  },
  listenText: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500',
  },
});
