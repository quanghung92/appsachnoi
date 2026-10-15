import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
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
  /** Chương đã tải về máy để nghe offline. */
  offlineChapterIds?: Set<string>;
  onClose: () => void;
  onSelectChapter: (chapter: Chapter) => void;
  onDownloadChapter?: (chapter: Chapter) => void;
  /** Callback tìm và cào tiêu đề dãy chương (vd: từ chương X đến X + 10) */
  onFetchChapterRange?: (startChapterNum: number, count?: number) => Promise<void>;
  isFetchingRange?: boolean;
}

export const ChapterListModal: React.FC<ChapterListModalProps> = ({
  visible,
  book,
  currentChapter,
  readyChapterIds,
  pendingChapterIds,
  offlineChapterIds,
  onClose,
  onSelectChapter,
  onDownloadChapter,
  onFetchChapterRange,
  isFetchingRange = false,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [searchText, setSearchText] = useState<string>('');
  const [localFetching, setLocalFetching] = useState<boolean>(false);
  const flatListRef = useRef<FlatList>(null);

  // Phân tích từ khóa tìm kiếm: tách số chương nếu có
  const { searchedChapterNum, filteredChapters } = useMemo(() => {
    if (!book) return { searchedChapterNum: null as number | null, filteredChapters: [] as Chapter[] };
    const trimmed = searchText.trim().toLowerCase();
    if (!trimmed) {
      return { searchedChapterNum: null as number | null, filteredChapters: book.chapters };
    }

    const matchNum = trimmed.match(/(?:chương|chuong|c)?\s*(\d+)/i);
    const parsedNum = matchNum ? parseInt(matchNum[1], 10) : null;

    const filtered = book.chapters.filter((c) => {
      const matchText = c.title.toLowerCase().includes(trimmed);
      const matchExactNum = parsedNum !== null && c.chapterNumber === parsedNum;
      return matchText || matchExactNum;
    });

    return { searchedChapterNum: parsedNum, filteredChapters: filtered };
  }, [book, searchText]);

  const isCurrentLoading = isFetchingRange || localFetching;

  // Tự động nạp tiêu đề thật từ web truyện nếu các chương đang hiển thị chưa có tên chi tiết
  // (đặt trước `if (!book) return null` để tuân thủ Rules of Hooks)
  React.useEffect(() => {
    if (!visible || !book || book.type !== 'web_novel' || !book.sourceUrl || !onFetchChapterRange || isCurrentLoading) return;
    const isGeneric = (t?: string) => !t || /^Chương\s+\d+[:\s\-–—]*$/i.test(t.trim());

    // Tìm chương đầu tiên trong danh mục chưa có tên thật
    const firstGeneric = book.chapters.find((c) => isGeneric(c.title));
    if (firstGeneric && firstGeneric.chapterNumber) {
      onFetchChapterRange(Math.max(1, firstGeneric.chapterNumber), 30).catch(() => {});
    }
  }, [visible, book?.id, currentChapter?.id, isCurrentLoading]);

  if (!book) return null;

  const handleTriggerFetchRange = async (num: number) => {
    if (!onFetchChapterRange || isCurrentLoading) return;
    try {
      setLocalFetching(true);
      await onFetchChapterRange(num, 11);
      // Xóa ô tìm kiếm để người dùng nhìn thấy danh mục đầy đủ và scroll đến chương đó
      setSearchText('');
    } finally {
      setLocalFetching(false);
    }
  };

  return (
    <Modal visible={visible} animationType={isWide ? 'fade' : 'slide'} transparent>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.sheet, isWide && styles.sheetWide]}>
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.title}>Mục Lục Chương</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {book.title} ({book.chapters.length} chương)
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Thanh tìm kiếm & Nhảy tới chương */}
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={Colors.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Tìm tên hoặc số chương (vd: 25, 120)..."
                placeholderTextColor={Colors.textMuted}
                value={searchText}
                onChangeText={setSearchText}
                keyboardType="default"
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (searchedChapterNum && searchedChapterNum > 0) {
                    handleTriggerFetchRange(searchedChapterNum);
                  }
                }}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Gợi ý Tìm & Nạp 11 chương khi người dùng gõ số chương */}
            {searchedChapterNum !== null && searchedChapterNum > 0 && onFetchChapterRange && (
              <TouchableOpacity
                style={styles.fetchRangeCard}
                onPress={() => handleTriggerFetchRange(searchedChapterNum)}
                disabled={isCurrentLoading}
              >
                <View style={styles.fetchRangeLeft}>
                  <Ionicons name="flash" size={18} color={Colors.primary} />
                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.fetchRangeTitle}>
                      Tìm Chương {searchedChapterNum} & 10 chương tiếp theo
                    </Text>
                    <Text style={styles.fetchRangeSubtitle}>
                      Cào tiêu đề từ Chương {searchedChapterNum} đến {searchedChapterNum + 10} từ web
                    </Text>
                  </View>
                </View>
                {isCurrentLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Ionicons name="arrow-forward-circle" size={24} color={Colors.primary} />
                )}
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            ref={flatListRef}
            data={filteredChapters}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="book-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Không tìm thấy chương trong danh sách hiện có</Text>
                {searchedChapterNum && onFetchChapterRange && (
                  <TouchableOpacity
                    style={styles.emptyFetchBtn}
                    onPress={() => handleTriggerFetchRange(searchedChapterNum)}
                    disabled={isCurrentLoading}
                  >
                    {isCurrentLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="cloud-download-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                        <Text style={styles.emptyFetchBtnText}>
                          Cào Chương {searchedChapterNum} & 10 chương tiếp từ web
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            }
            renderItem={({ item, index }) => {
              const isSelected = currentChapter?.id === item.id;
              const hasAudio = readyChapterIds?.has(item.id) ?? false;
              const isPending = !hasAudio && (pendingChapterIds?.has(item.id) ?? false);
              const isOffline = offlineChapterIds?.has(item.id) ?? false;
              const chapNumDisplay =
                item.chapterNumber ?? (index + 1 < 10 ? `0${index + 1}` : index + 1);

              return (
                <View style={[styles.item, isSelected && styles.selectedItem]}>
                  <TouchableOpacity
                    style={styles.itemMain}
                    onPress={() => {
                      onSelectChapter(item);
                      onClose();
                    }}
                  >
                    <View style={styles.itemLeft}>
                      <Text style={[styles.indexNumber, isSelected && { color: Colors.primary }]}>
                        {chapNumDisplay < 10 ? `0${chapNumDisplay}` : chapNumDisplay}
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
                          <Text style={styles.audioReadyText}>✓ Có audio giọng Kokoro</Text>
                        )}
                        {isPending && (
                          <Text style={styles.audioPendingText}>⏳ Đang chờ gen audio</Text>
                        )}
                        {isOffline && (
                          <Text style={styles.offlineText}>📥 Đã tải offline</Text>
                        )}
                      </View>
                    </View>

                    {isSelected ? (
                      <Ionicons name="volume-high" size={20} color={Colors.primary} />
                    ) : (
                      <Ionicons name="play-circle-outline" size={20} color={Colors.textMuted} />
                    )}
                  </TouchableOpacity>
                  {onDownloadChapter && !isOffline && (
                    <TouchableOpacity
                      style={styles.downloadBtn}
                      onPress={() => onDownloadChapter(item)}
                    >
                      <Ionicons name="download-outline" size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
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
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
  },
  downloadBtn: {
    padding: 8,
  },
  offlineText: {
    fontSize: 10.5,
    color: Colors.primary,
    fontWeight: '600',
    marginTop: 3,
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
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard || '#1c1c1e',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  fetchRangeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.35)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  fetchRangeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  fetchRangeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  fetchRangeSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 18,
  },
  emptyFetchBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
});
