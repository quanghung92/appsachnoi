import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Switch,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VoiceOption } from '../types';
import { VIETNAMESE_VOICES, ttsService } from '../services/ttsService';
import { batchService } from '../services/batchService';

interface VoiceSelectorModalProps {
  visible: boolean;
  selectedVoice: VoiceOption;
  onClose: () => void;
  onSelectVoice: (voice: VoiceOption) => void;
  onTestVoice?: (voice: VoiceOption) => void;
}

export const VoiceSelectorModal: React.FC<VoiceSelectorModalProps> = ({
  visible,
  selectedVoice,
  onClose,
  onSelectVoice,
  onTestVoice,
}) => {
  const [serverType, setServerType] = useState<'local' | 'custom'>(
    ttsService.getServerType()
  );
  const [serverStatus, setServerStatus] = useState<{
    checking: boolean;
    connected: boolean;
    message: string;
  }>({
    checking: false,
    connected: false,
    message: '',
  });

  const [isEditingIp, setIsEditingIp] = useState(false);
  const [customIp, setCustomIp] = useState(ttsService.getServerUrl());
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  // true: tải audio về máy để nghe lại offline; false: chỉ stream từ Drive
  const [saveToDevice, setSaveToDevice] = useState(true);
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);

  const loadSaveToDevice = async () => {
    try {
      setSaveToDevice(await batchService.getSaveToDevice());
    } catch {}
  };

  const handleToggleSaveToDevice = async (value: boolean) => {
    setSaveToDevice(value);
    try {
      await batchService.setSaveToDevice(value);
    } catch {}
  };

  const loadCacheSize = async () => {
    try {
      setCacheSize(await ttsService.getAudioCacheSize());
    } catch {
      setCacheSize(null);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await ttsService.clearAudioCache();
    } catch {}
    await loadCacheSize();
    setClearingCache(false);
  };

  const formatCacheSize = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '—';
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
  };

  const checkConnection = async () => {
    setServerStatus(prev => ({ ...prev, checking: true }));
    const result = await ttsService.testServerConnection();
    setServerStatus({
      checking: false,
      connected: result.success,
      message: result.message,
    });
    setServerType(ttsService.getServerType());
    setCustomIp(ttsService.getServerUrl());
  };

  const handleSelectLocal = async () => {
    ttsService.switchToLocal();
    setServerType('local');
    setIsEditingIp(false);
    await checkConnection();
  };

  const handleSelectTunnel = async () => {
    ttsService.switchToTunnel();
    setServerType('custom');
    setIsEditingIp(false);
    await checkConnection();
  };

  const handleSelectCustom = () => {
    setServerType('custom');
    setIsEditingIp(true);
  };

  const handleSaveIp = async () => {
    const v = customIp.trim();
    if (v) {
      if (/^https?:\/\//i.test(v) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(v)) {
        ttsService.setServerUrl(v);
      } else {
        ttsService.setServerIp(v);
      }
    }
    setServerType(ttsService.getServerType());
    setIsEditingIp(false);
    await checkConnection();
  };

  const handleTestVoicePress = async (voice: VoiceOption) => {
    if (testingVoiceId === voice.id) {
      // Nhấn lần nữa để dừng thử giọng
      await ttsService.stop();
      setTestingVoiceId(null);
      return;
    }

    setTestingVoiceId(voice.id);
    await ttsService.stop();
    ttsService.setVoice(voice);

    // Nếu callback ngoài có xử lý riêng thì gọi, còn không dùng luồng có feedback đầy đủ
    if (onTestVoice) {
      onTestVoice(voice);
    }

    ttsService.speak(
      voice.sampleText,
      () => {
        // Đọc xong
        setTestingVoiceId(null);
      },
      (err: any) => {
        // Có lỗi
        setTestingVoiceId(null);
        Alert.alert(
          'Không thể phát thử giọng',
          `${err?.message || 'Không thể tải âm thanh từ máy chủ AI'}\n\n` +
          `• Máy chủ: ${ttsService.getServerUrl()}\n` +
          `• Vui lòng đảm bảo điện thoại và máy tính cùng kết nối Wi-Fi.\n` +
          `• Đảm bảo lệnh 'python server.py' đang chạy trên máy tính.`,
          [{ text: 'Đã hiểu' }]
        );
      }
    );
  };

  const handleClose = () => {
    ttsService.stop();
    setTestingVoiceId(null);
    onClose();
  };

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        checkConnection();
        loadCacheSize();
        loadSaveToDevice();
      }, 0);
      return () => {
        clearTimeout(timer);
        ttsService.stop();
      };
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Giọng Đọc AI VieNeu 48kHz</Text>
              <Text style={styles.subtitle}>Mô hình AI đọc tiểu thuyết truyền cảm, tự nhiên</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Quick Server Switch (Local Wi-Fi vs Tunnel vs Custom) */}
          <View style={styles.switchContainer}>
            <TouchableOpacity
              style={[styles.switchBtn, serverType === 'local' && !isEditingIp && styles.switchBtnActive]}
              onPress={handleSelectLocal}
              activeOpacity={0.8}
            >
              <Ionicons
                name="laptop"
                size={13}
                color={serverType === 'local' && !isEditingIp ? '#0d1b2a' : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.switchBtnText,
                  serverType === 'local' && !isEditingIp && styles.switchBtnTextActive,
                ]}
              >
                Wi-Fi Local
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.switchBtn,
                serverType === 'custom' && !isEditingIp && ttsService.getServerUrl().includes('loca.lt') && styles.switchBtnActive,
              ]}
              onPress={handleSelectTunnel}
              activeOpacity={0.8}
            >
              <Ionicons
                name="flash"
                size={13}
                color={
                  serverType === 'custom' && !isEditingIp && ttsService.getServerUrl().includes('loca.lt')
                    ? '#0d1b2a'
                    : '#fbbf24'
                }
              />
              <Text
                style={[
                  styles.switchBtnText,
                  serverType === 'custom' && !isEditingIp && ttsService.getServerUrl().includes('loca.lt') && styles.switchBtnTextActive,
                ]}
              >
                Tunnel (4G)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.switchBtn, isEditingIp && styles.switchBtnActiveCustom]}
              onPress={handleSelectCustom}
              activeOpacity={0.8}
            >
              <Ionicons
                name="options-outline"
                size={13}
                color={isEditingIp ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.switchBtnText,
                  isEditingIp && styles.switchBtnTextCustom,
                ]}
              >
                Tùy chỉnh
              </Text>
            </TouchableOpacity>
          </View>

          {/* Server Connection Status Banner */}
          <View style={[styles.serverBanner, serverStatus.connected ? styles.serverBannerOk : styles.serverBannerWarn]}>
            <View style={styles.serverBannerLeft}>
              {serverStatus.checking ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <View style={[styles.statusDot, serverStatus.connected ? styles.dotGreen : styles.dotOrange]} />
              )}
              <View style={styles.serverBannerTextCol}>
                <Text style={styles.serverBannerTitle}>
                  {serverStatus.checking
                    ? 'Đang kiểm tra kết nối máy chủ AI...'
                    : serverStatus.connected
                    ? `${serverType === 'local' ? '💻 Máy tính Local' : '⚙️ Tùy chỉnh'}: Sẵn sàng`
                    : 'Chưa kết nối Máy chủ AI'}
                </Text>
                <Text style={styles.serverBannerSubtitle} numberOfLines={1}>
                  {serverStatus.connected
                    ? `Đang kết nối: ${ttsService.getServerUrl()}`
                    : `Chưa tới được: ${ttsService.getServerUrl()} (Kiểm tra Wi-Fi)`}
                </Text>
              </View>
            </View>

            <View style={styles.bannerActions}>
              <TouchableOpacity onPress={checkConnection} style={styles.refreshBtn} activeOpacity={0.7}>
                <Ionicons name="refresh" size={14} color={Colors.primary} />
                <Text style={styles.refreshBtnText}>Thử lại</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Inline IP / URL Editor */}
          {isEditingIp && (
            <View style={styles.ipEditorContainer}>
              <TextInput
                style={styles.ipInput}
                value={customIp}
                onChangeText={setCustomIp}
                placeholder="Nhập IP (192.168.x.x) hoặc URL Tunnel"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TouchableOpacity onPress={handleSaveIp} style={styles.saveIpBtn}>
                <Text style={styles.saveIpText}>Lưu & Thử</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Voice List in ScrollView */}
          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {VIETNAMESE_VOICES.map((voice) => {
              const isSelected = selectedVoice.id === voice.id;
              const isVieNeu = voice.id.startsWith('vieneu_');
              const isTesting = testingVoiceId === voice.id;

              return (
                <TouchableOpacity
                  key={voice.id}
                  style={[styles.voiceItem, isSelected && styles.selectedVoiceItem]}
                  onPress={() => {
                    onSelectVoice(voice);
                    handleClose();
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.voiceInfo}>
                    <View style={styles.voiceTitleRow}>
                      <Ionicons
                        name={voice.gender === 'female' ? 'woman' : 'man'}
                        size={17}
                        color={voice.gender === 'female' ? Colors.secondary : Colors.primary}
                      />
                      <Text style={styles.voiceName}>{voice.name}</Text>
                      <View style={[styles.tagBadge, isVieNeu ? styles.tagVieNeu : styles.tagEdge]}>
                        <Text style={[styles.tagBadgeText, isVieNeu ? styles.tagVieNeuText : styles.tagEdgeText]}>
                          {isVieNeu ? 'VieNeu 48k' : 'Edge'}
                        </Text>
                      </View>
                      {isSelected && (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>Đang dùng</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.voiceDesc}>{voice.description}</Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.testBtn, isTesting && styles.testBtnActive]}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleTestVoicePress(voice);
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel="Nghe thử giọng"
                  >
                    {isTesting ? (
                      <>
                        <ActivityIndicator size="small" color="#0d1b2a" />
                        <Text style={[styles.testBtnText, styles.testBtnTextActive]}>Dừng</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="volume-medium" size={16} color={Colors.textLight} />
                        <Text style={styles.testBtnText}>Thử giọng</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Tùy chọn lưu audio về máy hay chỉ stream */}
          <View style={styles.cacheRow}>
            <View style={styles.cacheInfo}>
              <Ionicons name="cloud-download-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.cacheText}>
                Lưu audio về máy để nghe lại offline (tắt: chỉ stream từ Drive)
              </Text>
            </View>
            <Switch
              value={saveToDevice}
              onValueChange={handleToggleSaveToDevice}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.textLight}
            />
          </View>

          {/* Audio cache trên máy */}
          <View style={styles.cacheRow}>
            <View style={styles.cacheInfo}>
              <Ionicons name="save-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.cacheText}>
                Audio đã lưu trên máy: {formatCacheSize(cacheSize)} (nghe lại offline, không tốn server)
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClearCache}
              disabled={clearingCache}
              style={styles.cacheClearBtn}
              activeOpacity={0.7}
            >
              {clearingCache ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.cacheClearText}>Xóa</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer Notice */}
          <View style={styles.footerNotice}>
            <Ionicons name="sparkles" size={15} color={Colors.primary} />
            <Text style={styles.noticeText}>
              VieNeu-TTS 48kHz chạy trực tiếp trên PC/Server với âm thanh chất lượng phòng thu.
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 18,
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
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 10,
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
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    backgroundColor: Colors.surfaceElevated,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  switchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  switchBtnActive: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  switchBtnActiveCustom: {
    backgroundColor: 'rgba(6, 214, 160, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  switchBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  switchBtnTextActive: {
    color: '#0d1b2a',
    fontWeight: '800',
  },
  switchBtnTextCustom: {
    color: Colors.primary,
    fontWeight: '700',
  },
  serverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  serverBannerOk: {
    backgroundColor: 'rgba(6, 214, 160, 0.08)',
    borderColor: 'rgba(6, 214, 160, 0.25)',
  },
  serverBannerWarn: {
    backgroundColor: 'rgba(255, 183, 3, 0.08)',
    borderColor: 'rgba(255, 183, 3, 0.25)',
  },
  serverBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#06d6a0',
  },
  dotOrange: {
    backgroundColor: '#ffb703',
  },
  serverBannerTextCol: {
    flex: 1,
  },
  serverBannerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  serverBannerSubtitle: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ipEditorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  ipInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  saveIpBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveIpText: {
    color: '#0d1b2a',
    fontSize: 11,
    fontWeight: '700',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  refreshBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.primary,
  },
  scrollList: {
    maxHeight: 340,
  },
  list: {
    gap: 8,
    paddingVertical: 2,
  },
  voiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectedVoiceItem: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(6, 214, 160, 0.08)',
  },
  voiceInfo: {
    flex: 1,
    marginRight: 8,
  },
  voiceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  voiceName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  tagBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tagBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  tagVieNeu: {
    backgroundColor: 'rgba(17, 138, 178, 0.2)',
  },
  tagVieNeuText: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '700',
  },
  tagEdge: {
    backgroundColor: 'rgba(255, 209, 102, 0.15)',
  },
  tagEdgeText: {
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: '700',
  },
  currentBadge: {
    backgroundColor: 'rgba(6, 214, 160, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  currentBadgeText: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '700',
  },
  voiceDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    minWidth: 78,
    justifyContent: 'center',
  },
  testBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  testBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textLight,
  },
  testBtnTextActive: {
    color: '#0d1b2a',
    fontWeight: '700',
  },
  footerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cacheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cacheInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  cacheText: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
  },
  cacheClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cacheClearText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textLight,
  },
  noticeText: {
    fontSize: 10.5,
    color: Colors.textMuted,
    flex: 1,
  },
});
