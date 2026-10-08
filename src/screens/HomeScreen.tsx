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
import { BookCard } from '../components/BookCard';
import { NovelCard } from '../components/NovelCard';
import { CategoryPills } from '../components/CategoryPills';

interface HomeScreenProps {
  books: Book[];
  novels: Book[];
  currentBook: Book | null;
  isPlaying: boolean;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  onSelectBook: (book: Book, chapter?: Chapter) => void;
  onTogglePlay: (book: Book) => void;
  onOpenImportModal: () => void;
}

const CATEGORIES = [
  'Tất Cả',
  'Kỹ năng sống',
  'Tài chính',
  'Tiên Hiệp',
  'Huyền Huyễn',
  'Khoa Huyễn',
  'Văn học',
  'Tâm lý học',
  'Tâm linh',
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  books,
  novels,
  currentBook,
  isPlaying,
  selectedCategory,
  onSelectCategory,
  onSelectBook,
  onTogglePlay,
  onOpenImportModal,
}) => {
  const featuredBook = books[0] || novels[0];

  const filteredBooks = books.filter((b) =>
    selectedCategory === 'Tất Cả' ? true : b.category.includes(selectedCategory)
  );

  const filteredNovels = novels.filter((n) =>
    selectedCategory === 'Tất Cả' ? true : n.category.includes(selectedCategory)
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Hero Featured Card */}
      {featuredBook && (
        <View style={styles.heroWrapper}>
          <TouchableOpacity
            style={styles.heroCard}
            onPress={() => onSelectBook(featuredBook)}
            activeOpacity={0.9}
          >
            <Image
              source={{ uri: featuredBook.coverUrl }}
              style={styles.heroImage}
              resizeMode="cover"
            />
            <View style={styles.heroOverlay}>
              <View style={styles.heroTag}>
                <Ionicons name="sparkles" size={12} color={Colors.primary} />
                <Text style={styles.heroTagText}>SÁCH NÓI ĐƯỢC NGHE NHIỀU NHẤT</Text>
              </View>

              <Text style={styles.heroTitle} numberOfLines={2}>
                {featuredBook.title}
              </Text>
              <Text style={styles.heroAuthor}>{featuredBook.author}</Text>
              <Text style={styles.heroDesc} numberOfLines={2}>
                {featuredBook.description}
              </Text>

              <View style={styles.heroActions}>
                <TouchableOpacity
                  style={styles.heroPlayBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    onTogglePlay(featuredBook);
                  }}
                >
                  <Ionicons
                    name={currentBook?.id === featuredBook.id && isPlaying ? 'pause' : 'play'}
                    size={16}
                    color={Colors.background}
                  />
                  <Text style={styles.heroPlayBtnText}>
                    {currentBook?.id === featuredBook.id && isPlaying ? 'Tạm dừng' : 'Nghe ngay'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.heroMeta}>
                  <Ionicons name="headset" size={14} color={Colors.textSecondary} />
                  <Text style={styles.heroMetaText}>{featuredBook.listenCount} lượt nghe</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Categories Filter */}
      <CategoryPills
        categories={CATEGORIES}
        selectedCategory={selectedCategory}
        onSelectCategory={onSelectCategory}
      />

      {/* Section 1: Kho Sách Google Drive (46+ Sách Bán Chạy) */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={[styles.sectionIndicator, { backgroundColor: Colors.primary }]} />
          <Text style={styles.sectionTitle}>Kho Sách Google Drive (46+ Sách)</Text>
        </View>
        <Text style={styles.sectionBadge}>Nguồn Online</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalGrid}
      >
        {filteredBooks.map((book) => {
          const isCurrent = currentBook?.id === book.id && isPlaying;
          return (
            <BookCard
              key={book.id}
              book={book}
              isPlaying={isCurrent}
              onPress={() => onSelectBook(book)}
              onPlayPress={() => onTogglePlay(book)}
            />
          );
        })}
      </ScrollView>

      {/* Section 2: Banner Dán Link / Đọc Theo Chương */}
      <View style={styles.importBannerWrapper}>
        <TouchableOpacity
          style={styles.importBanner}
          onPress={onOpenImportModal}
          activeOpacity={0.85}
        >
          <View style={styles.importBannerLeft}>
            <View style={styles.importIconBox}>
              <Ionicons name="flash" size={20} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.importBannerTitle}>Dán Link Sách Hoặc Truyện Bất Kỳ</Text>
              <Text style={styles.importBannerSubtitle}>
                Hỗ trợ Google Drive, TruyenFull, TangThuVien & tệp điện thoại
              </Text>
            </View>
          </View>
          <Ionicons name="arrow-forward-circle" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Section 3: Truyện Chữ Hot Đọc Theo Chương */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={[styles.sectionIndicator, { backgroundColor: Colors.secondary }]} />
          <Text style={styles.sectionTitle}>Truyện Chữ Cập Nhật Theo Chương</Text>
        </View>
        <Text style={styles.sectionBadge}>Tự Đổi Chương</Text>
      </View>

      <View style={styles.verticalList}>
        {filteredNovels.map((novel) => {
          const isCurrent = currentBook?.id === novel.id && isPlaying;
          return (
            <NovelCard
              key={novel.id}
              novel={novel}
              isPlaying={isCurrent}
              onPress={() => onSelectBook(novel)}
              onPlayPress={() => onTogglePlay(novel)}
            />
          );
        })}
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  heroWrapper: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  heroCard: {
    height: 240,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    opacity: 0.45,
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 15, 25, 0.65)',
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  heroTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.8,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  heroAuthor: {
    fontSize: 13,
    color: Colors.textLight,
    fontWeight: '600',
    marginTop: 2,
  },
  heroDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 6,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  heroPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  heroPlayBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.background,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroMetaText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIndicator: {
    width: 4,
    height: 16,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sectionBadge: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  horizontalGrid: {
    paddingHorizontal: 20,
    gap: 14,
  },
  importBannerWrapper: {
    paddingHorizontal: 20,
    marginVertical: 14,
  },
  importBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(6, 214, 160, 0.08)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  importBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 10,
  },
  importIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  importBannerSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  verticalList: {
    paddingHorizontal: 20,
  },
});
