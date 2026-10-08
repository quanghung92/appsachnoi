import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

interface SleepTimerModalProps {
  visible: boolean;
  activeMinutes: number | null;
  onClose: () => void;
  onSetTimer: (minutes: number | null) => void;
}

const TIMER_OPTIONS = [
  { label: '15 phút', minutes: 15 },
  { label: '30 phút', minutes: 30 },
  { label: '45 phút', minutes: 45 },
  { label: '60 phút', minutes: 60 },
  { label: 'Hết chương hiện tại', minutes: -1 }, // special code for end of chapter
];

export const SleepTimerModal: React.FC<SleepTimerModalProps> = ({
  visible,
  activeMinutes,
  onClose,
  onSetTimer,
}) => {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="moon" size={20} color={Colors.primary} />
              <Text style={styles.title}>Hẹn Giờ Tắt</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Âm thanh sẽ tự động dừng sau thời gian được chọn để bạn an tâm đi vào giấc ngủ.
          </Text>

          <View style={styles.optionsList}>
            {TIMER_OPTIONS.map((opt) => {
              const isSelected = activeMinutes === opt.minutes;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.optionBtn, isSelected && styles.selectedOption]}
                  onPress={() => {
                    onSetTimer(opt.minutes);
                    onClose();
                  }}
                >
                  <Text style={[styles.optionText, isSelected && styles.selectedOptionText]}>
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}

            {activeMinutes !== null && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  onSetTimer(null);
                  onClose();
                }}
              >
                <Text style={styles.cancelText}>Tắt chế độ hẹn giờ</Text>
              </TouchableOpacity>
            )}
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  description: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: 16,
  },
  optionsList: {
    gap: 8,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectedOption: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(6, 214, 160, 0.1)',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textLight,
  },
  selectedOptionText: {
    color: Colors.primary,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 6,
  },
  cancelText: {
    color: Colors.accentDanger,
    fontSize: 13,
    fontWeight: '600',
  },
});
