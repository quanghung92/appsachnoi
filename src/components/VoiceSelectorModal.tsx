import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VoiceOption } from '../types';
import { VIETNAMESE_VOICES } from '../services/ttsService';

interface VoiceSelectorModalProps {
  visible: boolean;
  selectedVoice: VoiceOption;
  onClose: () => void;
  onSelectVoice: (voice: VoiceOption) => void;
  onTestVoice: (voice: VoiceOption) => void;
}

export const VoiceSelectorModal: React.FC<VoiceSelectorModalProps> = ({
  visible,
  selectedVoice,
  onClose,
  onSelectVoice,
  onTestVoice,
}) => {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Giọng Đọc AI Microsoft Edge</Text>
              <Text style={styles.subtitle}>Chất lượng phòng thu, phát thanh tự nhiên 100%</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.list}>
            {VIETNAMESE_VOICES.map((voice) => {
              const isSelected = selectedVoice.id === voice.id;
              return (
                <TouchableOpacity
                  key={voice.id}
                  style={[styles.voiceItem, isSelected && styles.selectedVoiceItem]}
                  onPress={() => {
                    onSelectVoice(voice);
                    onClose();
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.voiceInfo}>
                    <View style={styles.voiceTitleRow}>
                      <Ionicons
                        name={voice.gender === 'female' ? 'woman' : 'man'}
                        size={18}
                        color={voice.gender === 'female' ? Colors.secondary : Colors.primary}
                      />
                      <Text style={styles.voiceName}>{voice.name}</Text>
                      {isSelected && (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>Đang dùng</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.voiceDesc}>{voice.description}</Text>
                  </View>

                  <TouchableOpacity
                    style={styles.testBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      onTestVoice(voice);
                    }}
                    accessibilityLabel="Nghe thử giọng"
                  >
                    <Ionicons name="volume-medium" size={18} color={Colors.textLight} />
                    <Text style={styles.testBtnText}>Thử giọng</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footerNotice}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.primary} />
            <Text style={styles.noticeText}>
              Hoàn toàn miễn phí, không giới hạn số từ và không cần API key.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
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
  list: {
    gap: 12,
  },
  voiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectedVoiceItem: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(6, 214, 160, 0.08)',
  },
  voiceInfo: {
    flex: 1,
    marginRight: 10,
  },
  voiceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  currentBadge: {
    backgroundColor: 'rgba(6, 214, 160, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  currentBadgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  voiceDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  testBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textLight,
  },
  footerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  noticeText: {
    fontSize: 11,
    color: Colors.textMuted,
    flex: 1,
  },
});
