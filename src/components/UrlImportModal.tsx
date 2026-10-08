import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Colors } from '../theme/colors';
import { crawlerService } from '../services/crawlerService';
import { Book } from '../types';

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
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleImportUrl = async (playImmediately: boolean) => {
    if (!url.trim()) {
      Alert.alert('Chưa nhập liên kết', 'Vui lòng dán link Google Drive, web truyện hoặc bài viết cần đọc.');
      return;
    }

    setIsLoading(true);
    try {
      const book = await crawlerService.parseUrl(url);
      setIsLoading(false);
      setUrl('');
      onBookImported(book, playImmediately);
      onClose();
    } catch (err) {
      setIsLoading(false);
      Alert.alert('Lỗi phân tích', 'Không thể bóc tách nội dung từ đường dẫn này. Vui lòng kiểm tra lại liên kết.');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const book = crawlerService.parseLocalFile(file.name);
        onBookImported(book, true);
        onClose();
      }
    } catch (err) {
      console.log('Pick document cancelled or failed');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name="link" size={20} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.title}>Thêm Sách & Truyện Mới</Text>
                <Text style={styles.subtitle}>Đọc trực tiếp từ link hoặc tệp cá nhân</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

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
            />
          </View>

          {/* Local File Picker Alternative */}
          <TouchableOpacity style={styles.filePickerBtn} onPress={handlePickDocument}>
            <Ionicons name="document-attach-outline" size={20} color={Colors.secondary} />
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
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border,
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
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    padding: 4,
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
    paddingVertical: 6,
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
    minHeight: 80,
    marginBottom: 12,
  },
  input: {
    color: Colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    height: '100%',
  },
  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    borderStyle: 'dashed',
    marginBottom: 18,
  },
  filePickerText: {
    color: Colors.textLight,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
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
