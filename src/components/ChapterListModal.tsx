import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';

interface ChapterListModalProps {
  visible: boolean;
  book: Book | null;
  currentChapter: Chapter | null;
  /** Chương đã có audio gen sẵn trên batch server (đồng bộ từ server). */
  readyChapterIds?: Set<string>;
  /** Chương đang nằm trong hàng đợi gen trên server. */
  pendingChapterIds?: Set<string>;
  onClose: () => void;
  onSelectChapter: (chapter: Chapter) => void;
}

export const ChapterListModal: React.FC<ChapterListModalProps> = ({
  visible,
  book,
  currentChapter,
  readyChapterIds,
  pendingChapterIds,
  onClose,
  onSelectChapter,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  if (!book) return null;

  return (
    <Modal visible={visible} animationType={isWide ? 'fade' : 'slide'} transparent>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.sheet, isWide && styles.sheetWide]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Danh Sách Chương</Text>
              <Text style={styles.subtitle}>{book.title} ({book.chapters.length} chương)</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={book.chapters}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => {
              const isSelected = currentChapter?.id === item.id;
              const hasAudio = readyChapterIds?.has(item.id) ?? false;
              const isPending = !hasAudio && (pendingChapterIds?.has(item.id) ?? false);
              return (
                <TouchableOpacity
                  style={[styles.item, isSelected && styles.selectedItem]}
                  onPress={() => {
                    onSelectChapter(item);
                    onClose();
                  }}
                >
                  <View style={styles.itemLeft}>
                    <Text style={[styles.indexNumber, isSelected && { color: Colors.primary }]}>
                      {index + 1 < 10 ? `0${index + 1}` : index + 1}
                    </Text>
                    <View style={styles.itemMeta}>
                      <Text
                        style={[styles.chapterTitle, isSelected && { color: Colors.primary }]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      {item.duration && (
                        <Text style={styles.durationText}>{item.duration}</Text>
                      )}
                      {hasAudio && (
                        <Text style={styles.audioReadyText}>✓ Có audio giọng Gemini</Text>
                      )}
                      {isPending && (
                        <Text style={styles.audioPendingText}>⏳ Đang chờ gen audio</Text>
                      )}
                    </View>
                  </View>

                  {isSelected ? (
                    <Ionicons name="volume-high" size={20} color={Colors.primary} />
                  ) : (
                    <Ionicons name="play-circle-outline" size={20} color={Colors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  overlayWide: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 24,
  },
  sheetWide: {
    maxWidth: 580,
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '82%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  selectedItem: {
    backgroundColor: 'rgba(6, 214, 160, 0.1)',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  indexNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    width: 32,
  },
  itemMeta: {
    flex: 1,
  },
  chapterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  durationText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 3,
  },
  audioReadyText: {
    fontSize: 10.5,
    color: Colors.primary,
    fontWeight: '600',
    marginTop: 3,
  },
  audioPendingText: {
    fontSize: 10.5,
    color: Colors.textMuted,
    marginTop: 3,
  },
});
