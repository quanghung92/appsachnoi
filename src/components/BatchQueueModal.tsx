import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book } from '../types';
import { batchService, BatchQueueItem } from '../services/batchService';

interface BatchQueueModalProps {
  visible: boolean;
  books: Book[];
  onClose: () => void;
  /** User chọn batch 1 cuốn sách/truyện cụ thể (đẩy lên đầu hàng đợi). */
  onBatchBook: (book: Book, all?: boolean) => void;
}

export const BatchQueueModal: React.FC<BatchQueueModalProps> = ({
  visible,
  books,
  onClose,
  onBatchBook,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [autoBatch, setAutoBatch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [linkingBook, setLinkingBook] = useState<Book | null>(null);
  const [serverIdInput, setServerIdInput] = useState('');
  const [serverIds, setServerIds] = useState<Record<string, string>>({});

  const bookTitleOf = (bookId: string) =>
    books.find((b) => b.id === bookId)?.title || bookId;

  const loadQueue = useCallback(async () => {
    if (!batchService.isConfigured()) {
      setQueue([]);
      return;
    }
    setLoading(true);
    try {
      const [q, ab] = await Promise.all([
        batchService.getQueue(),
        batchService.getAutoBatch(),
      ]);
      setQueue(q);
      setAutoBatch(ab);
      // Load server book ID links
      const ids: Record<string, string> = {};
      for (const b of books) {
        const sid = await batchService.getServerBookId(b.id);
        if (sid) ids[b.id] = sid;
      }
      setServerIds(ids);
    } catch {}
    setLoading(false);
  }, [books]);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        loadQueue();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [visible, loadQueue]);

  const handleToggleAutoBatch = async (value: boolean) => {
    setAutoBatch(value);
    await batchService.setAutoBatch(value);
  };

  const handleMove = async (item: BatchQueueItem, direction: 'up' | 'down') => {
    const ok = await batchService.moveQueueItem(item.book_id, item.chapter_id, direction);
    if (ok) {
      setQueue(await batchService.getQueue());
    }
  };

  const handleRemove = (item: BatchQueueItem) => {
    Alert.alert('Xóa khỏi hàng đợi', `"${item.title}" sẽ không được gen.`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          await batchService.removeQueueItem(item.book_id, item.chapter_id);
          setQueue(await batchService.getQueue());
        },
      },
    ]);
  };

  const handleTriggerNow = async () => {
    setTriggering(true);
    const ok = await batchService.triggerNow(10);
    setTriggering(false);
    if (ok) batchService.invalidateIndexCache();
    Alert.alert(
      ok ? 'Đã kích hoạt' : 'Lỗi',
      ok ? 'Server đang gen theo thứ tự hàng đợi.' : 'Không gọi được server batch.'
    );
  };

  const renderQueueItem = ({ item, index }: { item: BatchQueueItem; index: number }) => (
    <View style={styles.queueItem}>
      <Text style={styles.queueIndex}>{index + 1}</Text>
      <View style={styles.queueMeta}>
        <Text style={styles.queueTitle} numberOfLines={1}>{item.title || item.chapter_id}</Text>
        <Text style={styles.queueSub} numberOfLines={1}>
          {bookTitleOf(item.book_id)} · {item.engine === 'kokoro' ? 'Kokoro' : item.engine}
        </Text>
      </View>
      <View style={styles.queueActions}>
        <TouchableOpacity
          style={styles.qBtn}
          onPress={() => handleMove(item, 'up')}
          disabled={index === 0}
        >
          <Ionicons name="chevron-up" size={18} color={index === 0 ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.qBtn}
          onPress={() => handleMove(item, 'down')}
          disabled={index === queue.length - 1}
        >
          <Ionicons name="chevron-down" size={18} color={index === queue.length - 1 ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.qBtn} onPress={() => handleRemove(item)}>
          <Ionicons name="close" size={18} color={Colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleBatchPress = (book: Book) => {
    Alert.alert(`Batch "${book.title}"`, 'Đẩy lên đầu hàng đợi:', [
      { text: 'Hủy', style: 'cancel' },
      { text: '10 chương tiếp theo', onPress: () => onBatchBook(book, false) },
      { text: 'Toàn bộ sách', onPress: () => onBatchBook(book, true) },
    ]);
  };

  const openLinkDialog = async (book: Book) => {
    const current = await batchService.getServerBookId(book.id);
    setServerIdInput(current || '');
    setLinkingBook(book);
  };

  const saveLink = async () => {
    if (!linkingBook) return;
    const sid = serverIdInput.trim();
    if (sid) {
      await batchService.setServerBookId(linkingBook.id, sid);
      setServerIds((prev) => ({ ...prev, [linkingBook.id]: sid }));
      Alert.alert('Đã liên kết', `"${linkingBook.title}" → server book ${sid}`);
    } else {
      // Xóa liên kết: set rỗng
      await batchService.setServerBookId(linkingBook.id, '');
      setServerIds((prev) => {
        const next = { ...prev };
        delete next[linkingBook.id];
        return next;
      });
    }
    setLinkingBook(null);
    setServerIdInput('');
  };

  const renderBookItem = ({ item }: { item: Book }) => {
    const linked = serverIds[item.id];
    return (
      <View style={styles.bookItem}>
        <View style={styles.bookMeta}>
          <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.bookSub} numberOfLines={1}>
            {item.chapters.length} chương · Kokoro{linked ? ` · 🔗 ${linked}` : ' · chưa liên kết server'}
          </Text>
        </View>
        <TouchableOpacity style={styles.linkBtn} onPress={() => openLinkDialog(item)}>
          <Ionicons name="link-outline" size={15} color={linked ? Colors.primary : Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.batchBtn} onPress={() => handleBatchPress(item)}>
          <Ionicons name="cloud-upload-outline" size={15} color={Colors.background} />
          <Text style={styles.batchBtnText}>Batch</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType={isWide ? 'fade' : 'slide'} transparent>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.sheet, isWide && styles.sheetWide]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Hàng đợi Batch</Text>
              <Text style={styles.subtitle}>Worker gen mỗi giờ · thứ tự = độ ưu tiên</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Cài đặt + Gen ngay */}
          <View style={styles.controlsRow}>
            <View style={styles.autoRow}>
              <Text style={styles.autoLabel}>Tự batch sách đang nghe</Text>
              <Switch
                value={autoBatch}
                onValueChange={handleToggleAutoBatch}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.textLight}
              />
            </View>
            <TouchableOpacity
              style={styles.triggerBtn}
              onPress={handleTriggerNow}
              disabled={triggering}
            >
              {triggering ? (
                <ActivityIndicator color={Colors.background} size="small" />
              ) : (
                <>
                  <Ionicons name="flash" size={15} color={Colors.background} />
                  <Text style={styles.triggerBtnText}>Gen ngay</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={Colors.primary} size="large" style={styles.loader} />
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              <Text style={styles.sectionTitle}>Đang chờ ({queue.length})</Text>
              {queue.length === 0 ? (
                <Text style={styles.emptyText}>Hàng đợi trống.</Text>
              ) : (
                queue.map((item, index) => (
                  <View key={`${item.book_id}/${item.chapter_id}`}>
                    {renderQueueItem({ item, index })}
                  </View>
                ))
              )}
              <Text style={styles.sectionTitle}>Chọn sách để batch</Text>
              <Text style={styles.sectionHint}>
                Đẩy các chương (từ vị trí đang nghe) lên đầu hàng đợi — gen trước các mục khác, tự crawl xếp sau cùng.
              </Text>
              {books.map((b) => (
                <View key={b.id}>{renderBookItem({ item: b })}</View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Dialog liên kết book với server book_id */}
      <Modal visible={!!linkingBook} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={styles.linkCard}>
            <Text style={styles.linkTitle}>Liên kết server</Text>
            <Text style={styles.linkSub} numberOfLines={2}>
              &quot;{linkingBook?.title}&quot; → nhập book_id trên server (vd: n224d74b8a6). Để trống để hủy liên kết.
            </Text>
            <TextInput
              style={styles.linkInput}
              value={serverIdInput}
              onChangeText={setServerIdInput}
              placeholder="server book_id"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.linkActions}>
              <TouchableOpacity
                style={[styles.linkActionBtn, styles.linkCancel]}
                onPress={() => { setLinkingBook(null); setServerIdInput(''); }}
              >
                <Text style={styles.linkCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.linkActionBtn, styles.linkSave]}
                onPress={saveLink}
              >
                <Text style={styles.linkSaveText}>Lưu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    maxHeight: '85%',
    paddingBottom: 24,
  },
  sheetWide: {
    maxWidth: 620,
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '85%',
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
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  autoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  triggerBtnText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: '700',
  },
  loader: {
    marginVertical: 40,
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  queueIndex: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
    width: 28,
  },
  queueMeta: {
    flex: 1,
    marginRight: 8,
  },
  queueTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  queueSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qBtn: {
    padding: 6,
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bookMeta: {
    flex: 1,
    marginRight: 10,
  },
  bookTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  bookSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  batchBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '700',
  },
  linkBtn: {
    padding: 8,
    marginRight: 4,
  },
  linkCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 32,
    alignSelf: 'center',
    width: '80%',
  },
  linkTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  linkSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 12,
  },
  linkInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  linkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  linkActionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  linkCancel: {
    backgroundColor: Colors.surfaceElevated,
  },
  linkCancelText: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  linkSave: {
    backgroundColor: Colors.primary,
  },
  linkSaveText: {
    color: Colors.background,
    fontWeight: '700',
  },
});
