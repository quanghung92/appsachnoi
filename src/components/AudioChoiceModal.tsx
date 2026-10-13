import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Book, Chapter } from '../types';

interface AudioChoiceModalProps {
  visible: boolean;
  book: Book | null;
  chapter: Chapter | null;
  onPlayRealtime: () => void;
  onEnqueueBatch: () => void;
  onClose: () => void;
}

export const AudioChoiceModal: React.FC<AudioChoiceModalProps> = ({
  visible,
  book,
  chapter,
  onPlayRealtime,
  onEnqueueBatch,
  onClose,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  if (!book || !chapter) return null;

  return (
    <Modal visible={visible} animationType={isWide ? 'fade' : 'slide'} transparent>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.card, isWide && styles.cardWide]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="headset" size={24} color={Colors.primary} />
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Info */}
          <Text style={styles.title}>Chưa Có Audio Gen Sẵn</Text>
          <Text style={styles.subtitle}>
            Chương <Text style={styles.highlightText}>&quot;{chapter.title}&quot;</Text> ({book.title}) chưa có file
            âm thanh MP3 trên Google Drive. Bạn muốn:
          </Text>

          {/* Options */}
          <View style={styles.optionsList}>
            {/* Option 1: Nghe Realtime */}
            <TouchableOpacity
              style={[styles.optionCard, styles.optionCardPrimary]}
              onPress={onPlayRealtime}
              activeOpacity={0.85}
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="play" size={22} color={Colors.background} />
              </View>
              <View style={styles.optionContent}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitlePrimary}>Nghe ngay bằng TTS trực tiếp</Text>
                  <View style={styles.badgeInstant}>
                    <Text style={styles.badgeInstantText}>NGAY LẬP TỨC</Text>
                  </View>
                </View>
                <Text style={styles.optionDescPrimary}>
                  Đọc ngay nội dung văn bản bằng giọng AI của máy hoặc server realtime, không cần chờ đợi.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2: Đưa vào hàng đợi Batch */}
            <TouchableOpacity
              style={styles.optionCard}
              onPress={onEnqueueBatch}
              activeOpacity={0.85}
            >
              <View style={[styles.optionIconBox, styles.optionIconBoxSecondary]}>
                <Ionicons name="cloud-upload" size={20} color={Colors.primary} />
              </View>
              <View style={styles.optionContent}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>Đưa vào hàng đợi gen audio</Text>
                  <View style={styles.badgeServer}>
                    <Text style={styles.badgeServerText}>BATCH SERVER</Text>
                  </View>
                </View>
                <Text style={styles.optionDesc}>
                  Xếp chương vào hàng đợi của server để gen MP3 chuẩn phòng thu lên Drive. Xem tiến độ ở tab Hàng Đợi.
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Footer cancel */}
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Để sau</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  overlayWide: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardWide: {
    maxWidth: 520,
    width: '100%',
    borderRadius: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 18,
  },
  highlightText: {
    color: Colors.primary,
    fontWeight: '700',
  },
  optionsList: {
    gap: 12,
    marginBottom: 16,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionCardPrimary: {
    backgroundColor: 'rgba(6, 214, 160, 0.08)',
    borderColor: 'rgba(6, 214, 160, 0.35)',
  },
  optionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionIconBoxSecondary: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
  },
  optionContent: {
    flex: 1,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  optionTitlePrimary: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  badgeInstant: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeInstantText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.background,
  },
  badgeServer: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeServerText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.secondary,
  },
  optionDesc: {
    fontSize: 11.5,
    color: Colors.textMuted,
    lineHeight: 16,
    marginTop: 4,
  },
  optionDescPrimary: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 4,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
});
