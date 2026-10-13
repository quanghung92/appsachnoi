import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';
import { batchService, BatchQueueItem } from '../services/batchService';

interface QueueScreenProps {
  books: Book[];
  onSelectBook?: (book: Book, chapter?: Chapter) => void;
  onBatchBook: (book: Book, all?: boolean) => Promise<void | number>;
}

export const QueueScreen: React.FC<QueueScreenProps> = ({
  books,
  onSelectBook,
  onBatchBook,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const isLarge = width >= 1200;

  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [autoBatch, setAutoBatch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [serverStatus, setServerStatus] = useState<{
    checking: boolean;
    connected: boolean;
    pendingCount?: number;
    doneCount?: number;
    error?: string;
  }>({
    checking: true,
    connected: false,
  });

  const [linkingBook, setLinkingBook] = useState<Book | null>(null);
  const [serverIdInput, setServerIdInput] = useState('');
  const [serverIds, setServerIds] = useState<Record<string, string>>({});

  const bookTitleOf = (bookId: string) =>
    books.find((b) => b.id === bookId)?.title || bookId;

  const checkServerAndLoadQueue = useCallback(async () => {
    setLoading(true);
    setServerStatus((prev) => ({ ...prev, checking: true, error: undefined }));

    if (!batchService.isConfigured()) {
      setServerStatus({
        checking: false,
        connected: false,
        error: 'Chưa cấu hình URL server batch',
      });
      setQueue([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Kiểm tra status server
      const status = await batchService.getStatus();
      const connected = status !== null;

      // 2. Tải hàng đợi + cài đặt
      const [q, ab] = await Promise.all([
        batchService.getQueue(),
        batchService.getAutoBatch(),
      ]);

      setQueue(q);
      setAutoBatch(ab);
      setServerStatus({
        checking: false,
        connected,
        pendingCount: status?.pending ?? q.length,
        doneCount: status?.done ?? 0,
      });

      // 3. Tải map server book IDs
      const ids: Record<string, string> = {};
      for (const b of books) {
        const sid = await batchService.getServerBookId(b.id);
        if (sid) ids[b.id] = sid;
      }
      setServerIds(ids);
    } catch (e: any) {
      setServerStatus({
        checking: false,
        connected: false,
        error: e?.message || 'Không thể kết nối tới server batch',
      });
    }
    setLoading(false);
  }, [books]);

  useEffect(() => {
    const timer = setTimeout(() => {
      checkServerAndLoadQueue();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkServerAndLoadQueue]);

  const handleToggleAutoBatch = async (value: boolean) => {
    setAutoBatch(value);
    await batchService.setAutoBatch(value);
  };

  const handleMove = async (item: BatchQueueItem, direction: 'up' | 'down') => {
    const ok = await batchService.moveQueueItem(item.book_id, item.chapter_id, direction);
    if (ok) {
      const updated = await batchService.getQueue();
      setQueue(updated);
    } else {
      Alert.alert('Không thể đổi vị trí', 'Lỗi kết nối tới server batch.');
    }
  };

  const handleRemove = (item: BatchQueueItem) => {
    const doRemove = async () => {
      const ok = await batchService.removeQueueItem(item.book_id, item.chapter_id);
      if (ok) {
        setQueue((prev) =>
          prev.filter((it) => !(it.book_id === item.book_id && it.chapter_id === item.chapter_id))
        );
        setServerStatus((prev) => ({
          ...prev,
          pendingCount: Math.max((prev.pendingCount || 1) - 1, 0),
        }));
      } else {
        if (Platform.OS === 'web') {
          window.alert('Không thể xóa mục khỏi hàng đợi trên server.');
        } else {
          Alert.alert('Lỗi', 'Không thể xóa mục khỏi hàng đợi trên server.');
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Xóa "${item.title || item.chapter_id}" khỏi hàng đợi?`)) {
        doRemove();
      }
      return;
    }

    Alert.alert('Xóa khỏi hàng đợi', `"${item.title || item.chapter_id}" sẽ không được gen nữa.`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: doRemove,
      },
    ]);
  };

  const handleClearAllQueue = async () => {
    if (queue.length === 0) return;
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(`Xóa toàn bộ ${queue.length} chương khỏi hàng đợi trên server?`)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Xóa toàn bộ', `Xóa toàn bộ ${queue.length} chương khỏi hàng đợi?`, [
              { text: 'Hủy', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Xóa hết', style: 'destructive', onPress: () => resolve(true) },
            ]);
          });
    if (!confirmed) return;

    setLoading(true);
    await Promise.all(
      queue.map((it) => batchService.removeQueueItem(it.book_id, it.chapter_id))
    );
    setQueue([]);
    setServerStatus((prev) => ({ ...prev, pendingCount: 0 }));
    setLoading(false);
  };

  const handleTriggerNow = async () => {
    setTriggering(true);
    const ok = await batchService.triggerNow(10);
    setTriggering(false);
    if (ok) {
      batchService.invalidateIndexCache();
      if (Platform.OS === 'web') {
        window.alert('Đã kích hoạt! Server Modal đang chạy gen audio các chương trong hàng đợi.');
      } else {
        Alert.alert('Đã kích hoạt', 'Server đang chạy gen audio các chương trong hàng đợi.');
      }
      checkServerAndLoadQueue();
    } else {
      if (Platform.OS === 'web') {
        window.alert('Lỗi kích hoạt: Không thể gửi yêu cầu trigger tới server batch.');
      } else {
        Alert.alert('Lỗi kích hoạt', 'Không thể gửi yêu cầu trigger tới server batch.');
      }
    }
  };

  const handleBatchPress = (book: Book) => {
    if (Platform.OS === 'web') {
      const choice = window.prompt(
        `Xếp hàng cho "${book.title}":\nNhập "1" để thêm 10 chương tiếp theo.\nNhập "2" để thêm toàn bộ các chương còn lại.`,
        '1'
      );
      if (choice === '1') {
        onBatchBook(book, false).then(() => checkServerAndLoadQueue());
      } else if (choice === '2') {
        onBatchBook(book, true).then(() => checkServerAndLoadQueue());
      }
      return;
    }

    Alert.alert(`Xếp hàng: "${book.title}"`, 'Chọn số lượng chương đưa lên đầu hàng đợi:', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: '10 chương tiếp theo',
        onPress: async () => {
          await onBatchBook(book, false);
          checkServerAndLoadQueue();
        },
      },
      {
        text: 'Toàn bộ các chương',
        onPress: async () => {
          await onBatchBook(book, true);
          checkServerAndLoadQueue();
        },
      },
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
      Alert.alert('Đã liên kết', `"${linkingBook.title}" → server book ID: ${sid}`);
    } else {
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

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 1. Server Status Banner */}
      <View style={styles.statusBannerWrapper}>
        <View style={styles.statusBannerCard}>
          <View style={styles.statusTopRow}>
            <View style={styles.statusIndicatorBox}>
              <View
                style={[
                  styles.statusDot,
                  serverStatus.connected ? styles.dotGreen : styles.dotYellow,
                ]}
              />
              <View>
                <Text style={styles.statusTitle}>
                  {serverStatus.checking
                    ? 'Đang kiểm tra server...'
                    : serverStatus.connected
                    ? 'Batch Server Sẵn Sàng'
                    : 'Chưa Kết Nối Server Batch'}
                </Text>
                <Text style={styles.statusSubtitle} numberOfLines={1}>
                  {batchService.getServerUrl() || 'Chưa thiết lập URL'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={checkServerAndLoadQueue}
              disabled={loading}
              accessibilityLabel="Làm mới hàng đợi"
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="refresh" size={16} color={Colors.primary} />
                  <Text style={styles.refreshBtnText}>Làm mới</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Quick Metrics */}
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricNumber}>{queue.length}</Text>
              <Text style={styles.metricLabel}>Đang trong hàng đợi</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricNumber}>{serverStatus.doneCount ?? 0}</Text>
              <Text style={styles.metricLabel}>Đã gen trên server</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <TouchableOpacity
                style={[styles.triggerActionBtn, triggering && styles.triggerBtnDisabled]}
                onPress={handleTriggerNow}
                disabled={triggering || queue.length === 0}
              >
                {triggering ? (
                  <ActivityIndicator size="small" color={Colors.background} />
                ) : (
                  <>
                    <Ionicons name="flash" size={14} color={Colors.background} />
                    <Text style={styles.triggerActionBtnText}>Gen ngay ({queue.length})</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Auto Batch Setting */}
          <View style={styles.autoBatchRow}>
            <View style={styles.autoBatchInfo}>
              <Text style={styles.autoBatchTitle}>Tự động batch các chương tiếp theo</Text>
              <Text style={styles.autoBatchDesc}>
                Khi bạn nghe sách, hệ thống tự động đẩy 2 chương tiếp theo vào hàng đợi.
              </Text>
            </View>
            <Switch
              value={autoBatch}
              onValueChange={handleToggleAutoBatch}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.textLight}
            />
          </View>
        </View>
      </View>

      {/* 2. Hàng Đợi Hiện Tại */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="list" size={18} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Chương Đang Chờ Gen ({queue.length})</Text>
        </View>
        <View style={styles.sectionHeaderRight}>
          {queue.length > 0 && (
            <TouchableOpacity
              onPress={handleClearAllQueue}
              style={styles.clearAllQueueBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={14} color="#ef4444" />
              <Text style={styles.clearAllQueueText}>Xóa hết</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.sectionBadge}>Thứ tự = Độ ưu tiên</Text>
        </View>
      </View>

      {queue.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="checkmark-done-circle" size={42} color={Colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Hàng đợi đang trống</Text>
          <Text style={styles.emptySubtitle}>
            Không có chương nào đang chờ gen. Khi bạn bấm nghe một chương chưa có audio hoặc bấm nút
            &quot;Thêm vào hàng đợi&quot; bên dưới, chương sẽ xuất hiện ở đây.
          </Text>
        </View>
      ) : (
        <View style={styles.queueList}>
          {queue.map((item, index) => (
            <View key={`${item.book_id}_${item.chapter_id}_${index}`} style={styles.queueItem}>
              <View style={styles.queueNumberBox}>
                <Text style={styles.queueNumberText}>#{index + 1}</Text>
              </View>

              <View style={styles.queueMeta}>
                <Text style={styles.queueTitle} numberOfLines={1}>
                  {item.title || item.chapter_id}
                </Text>
                <Text style={styles.queueSubtitle} numberOfLines={1}>
                  {bookTitleOf(item.book_id)} • Giọng: {item.engine === 'kokoro' ? 'Kokoro' : item.engine}
                  {item.voice ? ` (${item.voice})` : ''}
                </Text>
              </View>

              <View style={styles.queueActions}>
                <TouchableOpacity
                  style={[styles.actionIconBtn, index === 0 && styles.actionIconBtnDisabled]}
                  onPress={() => handleMove(item, 'up')}
                  disabled={index === 0}
                  accessibilityLabel="Ưu tiên lên"
                >
                  <Ionicons
                    name="chevron-up"
                    size={18}
                    color={index === 0 ? Colors.textMuted : Colors.primary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionIconBtn,
                    index === queue.length - 1 && styles.actionIconBtnDisabled,
                  ]}
                  onPress={() => handleMove(item, 'down')}
                  disabled={index === queue.length - 1}
                  accessibilityLabel="Chuyển xuống"
                >
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={index === queue.length - 1 ? Colors.textMuted : Colors.primary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionIconBtn, styles.deleteActionBtn]}
                  onPress={() => handleRemove(item)}
                  accessibilityLabel="Xóa khỏi hàng đợi"
                >
                  <Ionicons name="trash-outline" size={17} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 3. Danh Sách Sách / Truyện Sẵn Có Để Thêm Vào Hàng Đợi */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="book-outline" size={18} color={Colors.secondary} />
          <Text style={styles.sectionTitle}>Kho Sách & Truyện Có Thể Batch</Text>
        </View>
        <Text style={styles.sectionBadge}>Chủ động gen trước</Text>
      </View>

      <View style={[styles.bookGrid, isWide && (isLarge ? styles.bookGrid3Col : styles.bookGrid2Col)]}>
        {books.map((book) => {
          const linkedId = serverIds[book.id];
          return (
            <View key={book.id} style={styles.bookCard}>
              <View style={styles.bookInfo}>
                <Text style={styles.bookTitle} numberOfLines={1}>
                  {book.title}
                </Text>
                <Text style={styles.bookMeta} numberOfLines={1}>
                  {book.category} • {book.chapters.length} chương
                  {linkedId ? ` • Server: ${linkedId}` : ''}
                </Text>
              </View>

              <View style={styles.bookBtnRow}>
                <TouchableOpacity
                  style={styles.batchBtn}
                  onPress={() => handleBatchPress(book)}
                >
                  <Ionicons name="cloud-upload" size={14} color={Colors.background} />
                  <Text style={styles.batchBtnText}>Xếp hàng</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linkServerBtn}
                  onPress={() => openLinkDialog(book)}
                  accessibilityLabel="Liên kết server book_id"
                >
                  <Ionicons
                    name={linkedId ? 'link' : 'link-outline'}
                    size={16}
                    color={linkedId ? Colors.primary : Colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Modal Dialog Liên Kết ID Server */}
      {linkingBook && (
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>Liên Kết ID Server</Text>
              <TouchableOpacity onPress={() => setLinkingBook(null)}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.dialogDesc}>
              Nhập mã book_id trên server batch cho sách &quot;{linkingBook.title}&quot; (ví dụ: n224d74b8a6).
              Để trống nếu muốn hủy liên kết.
            </Text>

            <TextInput
              style={styles.dialogInput}
              value={serverIdInput}
              onChangeText={setServerIdInput}
              placeholder="Nhập server book_id..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogCancelBtn}
                onPress={() => setLinkingBook(null)}
              >
                <Text style={styles.dialogCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogSaveBtn} onPress={saveLink}>
                <Text style={styles.dialogSaveText}>Lưu Liên Kết</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  statusBannerWrapper: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  statusBannerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusIndicatorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: Colors.primary,
  },
  dotYellow: {
    backgroundColor: Colors.accentWarm,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statusSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  metricNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  triggerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  triggerBtnDisabled: {
    opacity: 0.6,
  },
  triggerActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.background,
  },
  autoBatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  autoBatchInfo: {
    flex: 1,
    marginRight: 16,
  },
  autoBatchTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  autoBatchDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clearAllQueueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  clearAllQueueText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
  },
  sectionBadge: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(6, 214, 160, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
    maxWidth: 480,
  },
  queueList: {
    paddingHorizontal: 20,
    gap: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  queueNumberBox: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
  },
  queueMeta: {
    flex: 1,
    marginLeft: 8,
    marginRight: 10,
  },
  queueTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  queueSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionIconBtnDisabled: {
    opacity: 0.35,
  },
  deleteActionBtn: {
    backgroundColor: 'rgba(239, 71, 111, 0.08)',
    borderColor: 'rgba(239, 71, 111, 0.25)',
  },
  bookGrid: {
    paddingHorizontal: 20,
    gap: 10,
  },
  bookGrid2Col: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bookGrid3Col: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bookCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minWidth: 280,
    flex: 1,
  },
  bookInfo: {
    flex: 1,
    marginRight: 10,
  },
  bookTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  bookMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  bookBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  batchBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.background,
  },
  linkServerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dialogOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 999,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  dialogDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: 12,
  },
  dialogInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
  },
  dialogCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  dialogSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  dialogSaveText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.background,
  },
});
