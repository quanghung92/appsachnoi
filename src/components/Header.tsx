import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VoiceOption } from '../types';

interface HeaderProps {
  currentVoice: VoiceOption;
  onOpenVoiceSelector: () => void;
  onOpenImportModal: () => void;
  sleepTimerMinutes: number | null;
  onOpenSleepTimer: () => void;
  isWide?: boolean;
  activeTabTitle?: string;
}

export const Header: React.FC<HeaderProps> = ({
  currentVoice,
  onOpenVoiceSelector,
  onOpenImportModal,
  sleepTimerMinutes,
  onOpenSleepTimer,
  isWide = false,
  activeTabTitle = 'Khám Phá',
}) => {
  return (
    <View style={[styles.container, isWide && styles.containerWide]}>
      {isWide ? (
        <View style={styles.breadcrumbContainer}>
          <Text style={styles.breadcrumbTitle}>{activeTabTitle}</Text>
          <Text style={styles.breadcrumbSubtitle}>Kho Sách Nói & Truyện Chữ AI</Text>
        </View>
      ) : (
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="headset" size={20} color={Colors.primary} />
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Audio</Text>
              <Text style={[styles.title, { color: Colors.primary }]}>Verse</Text>
              <View style={styles.aiTag}>
                <Text style={styles.aiTagText}>AI</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>Sách Nói & Truyện Chữ AI</Text>
          </View>
        </View>
      )}

      <View style={styles.actionsRow}>
        {/* Sleep Timer Indicator */}
        <TouchableOpacity
          style={[styles.actionBtn, sleepTimerMinutes ? styles.activeTimerBtn : null]}
          onPress={onOpenSleepTimer}
          accessibilityLabel="Hẹn giờ tắt"
        >
          <Ionicons
            name="moon"
            size={18}
            color={sleepTimerMinutes ? Colors.primary : Colors.textSecondary}
          />
          {sleepTimerMinutes !== null && (
            <Text style={styles.timerBadgeText}>{sleepTimerMinutes}m</Text>
          )}
        </TouchableOpacity>

        {/* Storage / Audio Cache Button */}
        <TouchableOpacity
          style={styles.voiceBtn}
          onPress={onOpenVoiceSelector}
          accessibilityLabel="Quản lý bộ nhớ audio"
        >
          <Ionicons name="cloud-download-outline" size={16} color={Colors.secondary} />
          <Text style={styles.voiceBtnText} numberOfLines={1}>
            Bộ nhớ
          </Text>
        </TouchableOpacity>

        {/* Add/Import URL Button */}
        <TouchableOpacity
          style={styles.importBtn}
          onPress={onOpenImportModal}
          accessibilityLabel="Thêm link sách"
        >
          <Ionicons name="add" size={22} color={Colors.background} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: Colors.background,
  },
  containerWide: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  breadcrumbContainer: {
    justifyContent: 'center',
  },
  breadcrumbTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  breadcrumbSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  aiTag: {
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 4,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  aiTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.secondary,
  },
  subtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 36,
  },
  activeTimerBtn: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
  },
  timerBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 36,
  },
  voiceBtnText: {
    color: Colors.textLight,
    fontSize: 12,
    fontWeight: '600',
  },
  importBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
