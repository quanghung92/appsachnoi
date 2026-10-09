import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';

interface LibraryScreenProps {
  recentBooks: Book[];
  savedBooks: Book[];
  currentBook: Book | null;
  isPlaying: boolean;
  onSelectBook: (book: Book, chapter?: Chapter) => void;
  onTogglePlay: (book: Book) => void;
  onOpenImportModal: () => void;
  onDeleteBook: (book: Book) => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  recentBooks,
  savedBooks,
  currentBook,
  isPlaying,
  onSelectBook,
  onTogglePlay,
  onOpenImportModal,
  onDeleteBook,
}) => {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Top Banner */}
      <View style={styles.topCard}>
        <View style={styles.topCardContent}>
          <Text style={styles.topCardTitle}>Tủ Sách Thông Minh</Text>
          <Text style={styles.topCardSubtitle}>
            Quản lý sách đã nghe, lưu truyện yêu thích và nhập link đọc ngoại tuyến.
          </Text>
          <TouchableOpacity style={styles.addBookBtn} onPress={onOpenImportModal}>
            <Ionicons name="add-circle" size={18} color={Colors.background} />
            <Text style={styles.addBookBtnText}>Thêm Sách Từ Link / Tệp</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Section 1: Đang Nghe Dở */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="time" size={18} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Đang Nghe Dở</Text>
        </View>
        <Text style={styles.sectionCount}>{recentBooks.length} cuốn</Text>
      </View>

      {recentBooks.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Chưa có lịch sử nghe sách nào.</Text>
        </View>
      ) : (
        <View style={styles.recentList}>
          {recentBooks.map((book) => {
            const isCurrent = currentBook?.id === book.id && isPlaying;
            return (
              <TouchableOpacity
                key={book.id}
                style={styles.recentItem}
                onPress={() => onSelectBook(book)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: book.coverUrl }} style={styles.recentCover} />
                <View style={styles.recentInfo}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {book.title}
                  </Text>
                  <Text style={styles.recentAuthor}>{book.author}</Text>
                  <Text style={styles.recentChapter} numberOfLines={1}>
                    {book.chapters[0]?.title || 'Chương 1'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.miniPlayBtn, isCurrent && styles.miniPlayingBtn]}
                  onPress={(e) => {
                    e.stopPropagation();
                    onTogglePlay(book);
                  }}
                >
                  <Ionicons
                    name={isCurrent ? 'pause' : 'play'}
                    size={16}
                    color={isCurrent ? Colors.primary : Colors.background}
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Section 2: Sách & Link Đã Lưu */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="bookmark" size={18} color={Colors.secondary} />
          <Text style={styles.sectionTitle}>Sách & Link Đã Lưu ({savedBooks.length})</Text>
        </View>
      </View>

      {savedBooks.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Chưa có sách hoặc liên kết nào được lưu.</Text>
          <TouchableOpacity style={styles.emptyAction} onPress={onOpenImportModal}>
            <Text style={styles.emptyActionText}>Dán link sách đầu tiên của bạn</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.savedList}>
          {savedBooks.map((book) => (
            <TouchableOpacity
              key={book.id}
              style={styles.savedItem}
              onPress={() => onSelectBook(book)}
            >
              <Image source={{ uri: book.coverUrl }} style={styles.savedCover} />
              <View style={styles.savedInfo}>
                <Text style={styles.savedTitle} numberOfLines={1}>
                  {book.title}
                </Text>
                <Text style={styles.savedCategory}>{book.category} • {book.chapters.length} chương</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onDeleteBook(book);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={Colors.error} />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topCard: {
    margin: 20,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topCardContent: {
    alignItems: 'flex-start',
  },
  topCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  topCardSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  addBookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
  },
  addBookBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sectionCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  emptyBox: {
    marginHorizontal: 20,
    padding: 24,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  emptyAction: {
    marginTop: 10,
  },
  emptyActionText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  recentList: {
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recentCover: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
  },
  recentInfo: {
    flex: 1,
    marginLeft: 12,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  recentAuthor: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  recentChapter: {
    fontSize: 11,
    color: Colors.primary,
    marginTop: 2,
    fontWeight: '500',
  },
  miniPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayingBtn: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  savedList: {
    paddingHorizontal: 20,
    gap: 8,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  savedCover: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  savedInfo: {
    flex: 1,
    marginLeft: 10,
  },
  savedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  savedCategory: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 8,
    marginRight: 2,
  },
});
