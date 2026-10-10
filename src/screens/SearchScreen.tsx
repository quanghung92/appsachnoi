import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';
import { SearchBar } from '../components/SearchBar';
import { BookCard } from '../components/BookCard';
import { NovelCard } from '../components/NovelCard';

interface SearchScreenProps {
  books: Book[];
  currentBook: Book | null;
  isPlaying: boolean;
  onSelectBook: (book: Book, chapter?: Chapter) => void;
  onTogglePlay: (book: Book) => void;
  onOpenImportModal: () => void;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  books,
  currentBook,
  isPlaying,
  onSelectBook,
  onTogglePlay,
  onOpenImportModal,
}) => {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'drive' | 'novel'>('all');

  const filtered = books.filter((b) => {
    const matchesQuery =
      query.trim() === '' ||
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      b.author.toLowerCase().includes(query.toLowerCase()) ||
      b.category.toLowerCase().includes(query.toLowerCase());

    const matchesSource =
      sourceFilter === 'all' ||
      (sourceFilter === 'drive' && b.type === 'drive_book') ||
      (sourceFilter === 'novel' && b.type === 'web_novel');

    return matchesQuery && matchesSource;
  });

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <SearchBar
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Nhập tên sách, truyện hoặc tác giả..."
      />

      {/* Source Filters */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, sourceFilter === 'all' && styles.activeFilterChip]}
          onPress={() => setSourceFilter('all')}
        >
          <Text
            style={[styles.filterChipText, sourceFilter === 'all' && styles.activeFilterChipText]}
          >
            Tất cả ({books.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, sourceFilter === 'drive' && styles.activeFilterChip]}
          onPress={() => setSourceFilter('drive')}
        >
          <Ionicons
            name="logo-google"
            size={12}
            color={sourceFilter === 'drive' ? Colors.background : Colors.primary}
          />
          <Text
            style={[styles.filterChipText, sourceFilter === 'drive' && styles.activeFilterChipText]}
          >
            Google Drive
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, sourceFilter === 'novel' && styles.activeFilterChip]}
          onPress={() => setSourceFilter('novel')}
        >
          <Ionicons
            name="book-outline"
            size={12}
            color={sourceFilter === 'novel' ? Colors.background : Colors.secondary}
          />
          <Text
            style={[styles.filterChipText, sourceFilter === 'novel' && styles.activeFilterChipText]}
          >
            Truyện Chữ
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results List */}
      <ScrollView style={styles.resultsScroll} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="search-outline" size={36} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Không tìm thấy kết quả &quot;{query}&quot;</Text>
            <Text style={styles.emptySubtitle}>
              Bạn có thể dán đường dẫn trực tiếp hoặc tải tệp lên để nghe ngay.
            </Text>
            <TouchableOpacity style={styles.emptyImportBtn} onPress={onOpenImportModal}>
              <Ionicons name="link" size={16} color={Colors.background} />
              <Text style={styles.emptyImportBtnText}>Dán Link Để Đọc Ngay</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.resultsGrid}>
            {filtered.map((item) => {
              const isCurrent = currentBook?.id === item.id && isPlaying;
              if (item.type === 'web_novel') {
                return (
                  <NovelCard
                    key={item.id}
                    novel={item}
                    isPlaying={isCurrent}
                    onPress={() => onSelectBook(item)}
                    onPlayPress={() => onTogglePlay(item)}
                  />
                );
              }
              return (
                <BookCard
                  key={item.id}
                  book={item}
                  isPlaying={isCurrent}
                  onPress={() => onSelectBook(item)}
                  onPlayPress={() => onTogglePlay(item)}
                />
              );
            })}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginVertical: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activeFilterChip: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  activeFilterChipText: {
    color: Colors.background,
    fontWeight: '700',
  },
  resultsScroll: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  resultsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyImportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    marginTop: 20,
  },
  emptyImportBtnText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: '700',
  },
});
