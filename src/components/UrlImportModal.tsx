import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors } from '../theme/colors';
import { crawlerService } from '../services/crawlerService';
import { batchService } from '../services/batchService';
import { Book, Chapter } from '../types';

const isDriveLink = (url: string) => /drive\.google\.com/i.test(url);
const isNovelLink = (url: string) =>
  /truyenfull|tangthuvien|dtruyen|metruyenchu|metruyencv|wetruyen/i.test(url);

interface UrlImportModalProps {
  visible: boolean;
  onClose: () => void;
  onBookImported: (book: Book, playImmediately: boolean) => void;
}

export const UrlImportModal: React.FC<UrlImportModalProps> = ({
  visible,
  onClose,
  onBookImported,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleImportUrl = async (playImmediately: boolean) => {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert('Chưa nhập liên kết', 'Vui lòng dán link Google Drive, web truyện hoặc bài viết cần đọc.');
      return;
    }

    setIsLoading(true);
    try {
      if (batchService.isConfigured() && (isDriveLink(trimmed) || isNovelLink(trimmed))) {
        const book = await importViaBatch(trimmed);
        if (!book) {
          throw new Error('batch import failed');
        }
        finishImport(book, playImmediately);
        return;
      }
      const book = await crawlerService.parseUrl(trimmed);
      finishImport(book, playImmediately);
    } catch {
      setIsLoading(false);
      Alert.alert('Lỗi phân tích', 'Không thể bóc tách nội dung từ đường dẫn này. Vui lòng kiểm tra lại liên kết.');
    }
  };

  const finishImport = (book: Book, playImmediately: boolean) => {
    setIsLoading(false);
    setUrl('');
    onBookImported(book, playImmediately);
    onClose();
  };

  const importViaBatch = async (link: string): Promise<Book | null> => {
    if (isDriveLink(link)) {
      const result = await batchService.importBook(link);
      if (!result || result.chapters.length === 0) return null;
      const chapters: Chapter[] = result.chapters.map((c, i) => ({
        id: c.id,
        chapterNumber: i + 1,
        title: c.title,
        content: '',
      }));
      return {
        id: result.book_id,
        title: result.title,
        author: 'Sách PDF',
        category: 'Sách',
        description: `${chapters.length} chương — audio do server gen ban đêm.`,
        coverUrl: '',
        driveUrl: link,
        type: 'drive_book',
        chapters,
      };
    }
    const result = await batchService.importNovel(link);
    if (!result) return null;
    const cleanSource = link.replace(/\/+$/, '');
    const chapters: Chapter[] = [];
    const TOTAL = 1500;
    for (let n = 1; n <= TOTAL; n++) {
      chapters.push({
        id: `${result.book_id}_c${n}`,
        chapterNumber: n,
        title: `Chương ${n}`,
        url: crawlerService.buildChapterUrl(cleanSource, n),
        content: '',
      });
    }
    return {
      id: result.book_id,
      title: result.title,
      author: 'Truyện Web',
      category: 'Truyện Chữ',
      description: `${result.sample_chapter} — audio do server gen ban đêm.`,
      coverUrl: '',
      sourceUrl: link,
      type: 'web_novel',
      chapters,
    };
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const lowerName = (file.name || '').toLowerCase();
        // Chỉ hỗ trợ TXT: đọc nội dung thật. PDF/EPUB cần parser riêng.
        if (!lowerName.endsWith('.txt')) {
          Alert.alert(
            'Chưa hỗ trợ',
            `Định dạng "${file.name}" chưa được hỗ trợ. Hiện tại chỉ đọc được file .txt.`
          );
          return;
        }
        const uri = file.uri;
        if (!uri) {
          Alert.alert('Lỗi', 'Không đọc được file đã chọn.');
          return;
        }
        const content = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (!content || !content.trim()) {
          Alert.alert('Lỗi', 'File trống, không có nội dung để đọc.');
          return;
        }
        const book = crawlerService.parseLocalFile(file.name, content);
        onBookImported(book, true);
        onClose();
      }
    } catch (e) {
      console.log('Pick document failed:', e);
      Alert.alert('Lỗi', 'Không đọc được file đã chọn.');
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.overlay}>
          {/* Chạm vào vùng nền ngoài để đóng popup */}
          <TouchableWithoutFeedback onPress={onClose}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          <View style={[styles.card, isWide && styles.cardWide]}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.iconCircle}>
                  <Ionicons name="link" size={20} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>Thêm Sách & Truyện Mới</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>Đọc trực tiếp từ link hoặc tệp cá nhân</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Đóng popup"
              >
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {/* Quick Preset Buttons */}
              <View style={styles.presetsRow}>
                <TouchableOpacity
                  style={styles.presetChip}
                  onPress={() => setUrl('https://drive.google.com/open?id=1mlIagmYc0_B7E38xHcmyEYLSZj-qlLGM')}
                >
                  <Ionicons name="logo-google" size={14} color={Colors.primary} />
                  <Text style={styles.presetChipText}>Google Drive</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.presetChip}
                  onPress={() => setUrl('https://truyenfull.vn/pham-nhan-tu-tien/chuong-1/')}
                >
                  <Ionicons name="book-outline" size={14} color={Colors.secondary} />
                  <Text style={styles.presetChipText}>Truyện Chữ Web</Text>
                </TouchableOpacity>
              </View>

              {/* URL Input Box */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Dán liên kết Google Drive, Web Truyện hoặc Blog..."
                  placeholderTextColor={Colors.textMuted}
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Local File Picker Alternative */}
              <TouchableOpacity style={styles.filePickerBtn} onPress={handlePickDocument}>
                <Ionicons name="document-attach-outline" size={19} color={Colors.secondary} />
                <Text style={styles.filePickerText}>Hoặc chọn tệp PDF / EPUB / TXT từ điện thoại</Text>
              </TouchableOpacity>

              {/* Action Buttons */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.saveBtn]}
                  onPress={() => handleImportUrl(false)}
                  disabled={isLoading}
                >
                  <Ionicons name="bookmark-outline" size={18} color={Colors.textLight} />
                  <Text style={styles.saveBtnText}>Lưu vào tủ sách</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.playBtn]}
                  onPress={() => handleImportUrl(true)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color={Colors.background} size="small" />
                  ) : (
                    <>
                      <Ionicons name="play" size={18} color={Colors.background} />
                      <Text style={styles.playBtnText}>Nghe trực tiếp</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 15, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  cardWide: {
    maxWidth: 540,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  presetChip: {
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
  presetChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textLight,
  },
  inputContainer: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 12,
  },
  input: {
    color: Colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 68,
    maxHeight: 110,
    textAlignVertical: 'top',
  },
  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  filePickerText: {
    color: Colors.textLight,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtnText: {
    color: Colors.textLight,
    fontSize: 13,
    fontWeight: '600',
  },
  playBtn: {
    backgroundColor: Colors.primary,
  },
  playBtnText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: '700',
  },
});
