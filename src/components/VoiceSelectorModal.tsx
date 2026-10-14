import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VoiceOption } from '../types';
import { ttsService } from '../services/ttsService';
import { batchService } from '../services/batchService';

interface VoiceSelectorModalProps {
  visible: boolean;
  selectedVoice?: VoiceOption;
  onClose: () => void;
  onSelectVoice?: (voice: VoiceOption) => void;
  onTestVoice?: (voice: VoiceOption) => void;
}

const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export const VoiceSelectorModal: React.FC<VoiceSelectorModalProps> = ({
  visible,
  onClose,
}) => {
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [saveToDevice, setSaveToDevice] = useState(true);
  const [serverUrl, setServerUrl] = useState<string>(() => ttsService.getServerUrl());
  const [testingConnection, setTestingConnection] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  const handleToggleSaveToDevice = async (value: boolean) => {
    setSaveToDevice(value);
    try {
      await batchService.setSaveToDevice(value);
    } catch {}
  };

  const handleSaveAndTest = async () => {
    const trimmed = serverUrl.trim();
    if (!trimmed) {
      ttsService.switchToLocal();
      setServerUrl(ttsService.getServerUrl());
      setConnectionStatus({ success: true, message: 'Đã chuyển về mặc định máy cục bộ.' });
      return;
    }
    setTestingConnection(true);
    setConnectionStatus(null);
    ttsService.setServerUrl(trimmed);
    try {
      const res = await ttsService.testServerConnection();
      setConnectionStatus({ success: res.success, message: res.message });
    } catch {
      setConnectionStatus({ success: false, message: 'Không thể kết nối tới máy chủ.' });
    } finally {
      setTestingConnection(false);
    }
  };

  const loadCacheSize = async () => {
    try {
      setCacheSize(await ttsService.getAudioCacheSize());
    } catch {
      setCacheSize(null);
    }
  };

  const handleConfirmClearCache = () => {
    const doClear = async () => {
      setClearingCache(true);
      try {
        await ttsService.clearAudioCache();
      } catch {}
      await loadCacheSize();
      setClearingCache(false);
    };

    if (Platform.OS === 'web') {
      if (
        window.confirm(
          'Bạn có chắc chắn muốn xóa toàn bộ các tệp audio đã tải về trên máy? Bạn vẫn có thể tải lại bất kỳ lúc nào từ Google Drive.'
        )
      ) {
        doClear();
      }
      return;
    }

    Alert.alert(
      'Xóa bộ nhớ audio',
      'Bạn có chắc chắn muốn xóa toàn bộ các tệp audio đã tải về trên máy? Bạn vẫn có thể tải lại bất kỳ lúc nào từ Google Drive.',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa toàn bộ',
          style: 'destructive',
          onPress: doClear,
        },
      ]
    );
  };

  const formatCacheSize = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '0.0 MB';
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
  };

  const cachePercent = Math.min(
    Math.round(((cacheSize || 0) / MAX_CACHE_BYTES) * 100),
    100
  );

  useEffect(() => {
    let isMounted = true;
    if (visible) {
      Promise.all([
        ttsService.getAudioCacheSize().catch(() => null),
        batchService.getSaveToDevice().catch(() => true),
      ]).then(([size, save]) => {
        if (!isMounted) return;
        setCacheSize(size);
        setSaveToDevice(save);
        setServerUrl(ttsService.getServerUrl());
      });
    }
    return () => {
      isMounted = false;
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name="cloud-download" size={22} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.title}>Quản Lý Bộ Nhớ Audio</Text>
                <Text style={styles.subtitle}>Tải về & phát offline không tốn server</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Server Connection Card: Cloudflare Tunnel / Local IP */}
            <View style={styles.serverCard}>
              <View style={styles.serverCardHeader}>
                <Ionicons name="radio" size={18} color={Colors.primary} />
                <Text style={styles.serverCardTitle}>Máy Chủ Live Stream (Cloudflare Tunnel)</Text>
              </View>
              <Text style={styles.serverCardDesc}>
                Dán link Cloudflare Tunnel (https://xxx.trycloudflare.com) hoặc IP máy chạy server_streaming.py:
              </Text>
              <View style={styles.serverInputRow}>
                <TextInput
                  style={styles.serverInput}
                  placeholder="https://...trycloudflare.com"
                  placeholderTextColor={Colors.textMuted}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.testBtn, testingConnection && styles.testBtnDisabled]}
                  onPress={handleSaveAndTest}
                  disabled={testingConnection}
                >
                  {testingConnection ? (
                    <ActivityIndicator size="small" color={Colors.background} />
                  ) : (
                    <Text style={styles.testBtnText}>Lưu & Thử</Text>
                  )}
                </TouchableOpacity>
              </View>
              {connectionStatus && (
                <View
                  style={[
                    styles.statusBadge,
                    connectionStatus.success ? styles.statusBadgeSuccess : styles.statusBadgeError,
                  ]}
                >
                  <Ionicons
                    name={connectionStatus.success ? 'checkmark-circle' : 'alert-circle'}
                    size={15}
                    color={connectionStatus.success ? Colors.primary : '#ef4444'}
                  />
                  <Text
                    style={[
                      styles.statusBadgeText,
                      connectionStatus.success ? styles.statusBadgeTextSuccess : styles.statusBadgeTextError,
                    ]}
                  >
                    {connectionStatus.message}
                  </Text>
                </View>
              )}
            </View>

            {/* Setting: Lưu audio về máy */}
            <View style={styles.settingCard}>
              <View style={styles.settingTopRow}>
                <View style={styles.settingTitleCol}>
                  <View style={styles.titleWithBadge}>
                    <Text style={styles.settingTitle}>Tự động lưu audio về máy</Text>
                    <View style={styles.recommendBadge}>
                      <Text style={styles.recommendText}>Khuyên dùng</Text>
                    </View>
                  </View>
                  <Text style={styles.settingDesc}>
                    Lưu các chương đã tải vào bộ nhớ máy để nghe lại mượt mà khi mất mạng và không tốn băng thông. Khi tắt, app sẽ chỉ phát trực tiếp (stream) từ Google Drive.
                  </Text>
                </View>

                <Switch
                  value={saveToDevice}
                  onValueChange={handleToggleSaveToDevice}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.textLight}
                />
              </View>
            </View>

            {/* Storage Usage Card */}
            <View style={styles.storageCard}>
              <View style={styles.storageHeaderRow}>
                <View style={styles.storageIconBox}>
                  <Ionicons name="disc-outline" size={24} color={Colors.secondary} />
                </View>
                <View style={styles.storageInfoCol}>
                  <Text style={styles.storageLabel}>Audio đã lưu trên máy</Text>
                  <Text style={styles.storageValue}>{formatCacheSize(cacheSize)}</Text>
                </View>

                <TouchableOpacity
                  onPress={handleConfirmClearCache}
                  disabled={clearingCache || (cacheSize || 0) === 0}
                  style={[
                    styles.clearBtn,
                    ((cacheSize || 0) === 0 || clearingCache) && styles.clearBtnDisabled,
                  ]}
                  activeOpacity={0.8}
                >
                  {clearingCache ? (
                    <ActivityIndicator size="small" color={Colors.textPrimary} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={15} color="#ef4444" style={{ marginRight: 4 }} />
                      <Text style={styles.clearBtnText}>Xóa toàn bộ</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Progress bar of 2GB */}
              <View style={styles.progressBarWrapper}>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${Math.max(cachePercent, 2)}%` }]} />
                </View>
                <View style={styles.progressTextRow}>
                  <Text style={styles.progressSubtext}>
                    Đã dùng {formatCacheSize(cacheSize)} / 2.0 GB giới hạn
                  </Text>
                  <Text style={styles.progressPercentText}>{cachePercent}%</Text>
                </View>
              </View>
            </View>

            {/* Information Tips */}
            <View style={styles.infoBox}>
              <View style={styles.infoTitleRow}>
                <Ionicons name="information-circle-outline" size={17} color={Colors.primary} />
                <Text style={styles.infoTitle}>Thông tin bộ nhớ đệm</Text>
              </View>
              <Text style={styles.infoItem}>
                • Audio được lưu trữ dưới dạng MP3 chất lượng cao, chia theo từng chương.
              </Text>
              <Text style={styles.infoItem}>
                • Ứng dụng tự động dọn dẹp các tệp cũ khi tổng dung lượng vượt quá 2 GB (quy tắc LRU).
              </Text>
              <Text style={styles.infoItem}>
                • Bạn có thể nghe lại các chương đã tải bất cứ lúc nào ngay cả khi offline.
              </Text>
            </View>
          </ScrollView>

          {/* Footer Action */}
          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={styles.doneBtn} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>Hoàn tất</Text>
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
    backgroundColor: 'rgba(5, 7, 15, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  body: {
    maxHeight: 500,
  },
  serverCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(6, 214, 160, 0.3)',
    marginBottom: 14,
  },
  serverCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  serverCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  serverCardDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 17,
    marginBottom: 10,
  },
  serverInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverInput: {
    flex: 1,
    height: 42,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  testBtn: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnDisabled: {
    opacity: 0.6,
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.background,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  statusBadgeSuccess: {
    backgroundColor: 'rgba(6, 214, 160, 0.12)',
  },
  statusBadgeError: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusBadgeTextSuccess: {
    color: Colors.primary,
  },
  statusBadgeTextError: {
    color: '#ef4444',
  },
  settingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  settingTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  settingTitleCol: {
    flex: 1,
    marginRight: 14,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginRight: 8,
  },
  recommendBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  recommendText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  settingDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  storageCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  storageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  storageIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  storageInfoCol: {
    flex: 1,
  },
  storageLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  storageValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  clearBtnDisabled: {
    opacity: 0.4,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  progressBarWrapper: {
    marginTop: 4,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressSubtext: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  progressPercentText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  infoBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.15)',
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    marginLeft: 6,
  },
  infoItem: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 4,
  },
  footer: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  doneBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.background,
  },
});
