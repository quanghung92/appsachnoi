import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VoiceOption } from '../types';
import { VIETNAMESE_VOICES, ttsService } from '../services/ttsService';

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
  const [serverType, setServerType] = useState<'local' | 'cloud' | 'custom'>(
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

  const handleSelectPreset = async (type: 'local' | 'cloud') => {
    if (type === 'local') {
      ttsService.switchToLocal();
    } else {
      ttsService.switchToCloud();
    }
    setServerType(type);
    setIsEditingIp(false);
    await checkConnection();
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

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setServerType(ttsService.getServerType());
        checkConnection();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Giọng Đọc AI Kokoro & Edge</Text>
              <Text style={styles.subtitle}>Mô hình AI đọc tiểu thuyết truyền cảm, tự nhiên</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Quick Server Switch (1-Touch Segmented Control) */}
          <View style={styles.switchContainer}>
            <TouchableOpacity
              style={[styles.switchBtn, serverType === 'local' && styles.switchBtnActive]}
              onPress={() => handleSelectPreset('local')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="laptop"
                size={14}
                color={serverType === 'local' ? '#0d1b2a' : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.switchBtnText,
                  serverType === 'local' && styles.switchBtnTextActive,
                ]}
              >
                Máy tính (Local)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.switchBtn, serverType === 'cloud' && styles.switchBtnActive]}
              onPress={() => handleSelectPreset('cloud')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="cloud"
                size={14}
                color={serverType === 'cloud' ? '#0d1b2a' : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.switchBtnText,
                  serverType === 'cloud' && styles.switchBtnTextActive,
                ]}
              >
                Modal Cloud
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.switchBtn, (serverType === 'custom' || isEditingIp) && styles.switchBtnActiveCustom]}
              onPress={() => setIsEditingIp(!isEditingIp)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="options-outline"
                size={14}
                color={isEditingIp || serverType === 'custom' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.switchBtnText,
                  (serverType === 'custom' || isEditingIp) && styles.switchBtnTextCustom,
                ]}
              >
                Dự phòng
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
                    ? `${serverType === 'cloud' ? '☁️ Modal Cloud' : serverType === 'local' ? '💻 Máy tính Local' : '⚙️ Tùy chỉnh'}: Sẵn sàng`
                    : `${serverType === 'cloud' ? '☁️ Modal Cloud' : '💻 Máy tính Local'}: Chưa kết nối`}
                </Text>
                <Text style={styles.serverBannerSubtitle} numberOfLines={1}>
                  {serverStatus.connected
                    ? `Đang chạy qua: ${ttsService.getServerUrl()}`
                    : serverType === 'cloud'
                    ? 'Serverless tự động khởi động sau 1-2s (nhấn Thử lại)'
                    : 'Đảm bảo điện thoại chung Wi-Fi và server.py đang chạy'}
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

          {/* Inline IP / URL Editor (Dự phòng khi muốn nhập thủ công) */}
          {isEditingIp && (
            <View style={styles.ipEditorContainer}>
              <TextInput
                style={styles.ipInput}
                value={customIp}
                onChangeText={setCustomIp}
                placeholder="Nhập IP (192.168.x.x) hoặc URL server tùy chỉnh"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TouchableOpacity onPress={handleSaveIp} style={styles.saveIpBtn}>
                <Text style={styles.saveIpText}>Lưu & Thử</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Voice List */}
          <View style={styles.list}>
            {VIETNAMESE_VOICES.map((voice) => {
              const isSelected = selectedVoice.id === voice.id;
              const isKokoro = voice.id.startsWith('kokoro_');

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
                        size={17}
                        color={voice.gender === 'female' ? Colors.secondary : Colors.primary}
                      />
                      <Text style={styles.voiceName}>{voice.name}</Text>
                      <View style={[styles.tagBadge, isKokoro ? styles.tagKokoro : styles.tagEdge]}>
                        <Text style={[styles.tagBadgeText, isKokoro ? styles.tagKokoroText : styles.tagEdgeText]}>
                          {isKokoro ? 'Kokoro AI' : 'Edge'}
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
                    style={styles.testBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      onTestVoice(voice);
                    }}
                    accessibilityLabel="Nghe thử giọng"
                  >
                    <Ionicons name="volume-medium" size={16} color={Colors.textLight} />
                    <Text style={styles.testBtnText}>Thử giọng</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer Notice */}
          <View style={styles.footerNotice}>
            <Ionicons name="sparkles" size={15} color={Colors.primary} />
            <Text style={styles.noticeText}>
              Kokoro 82M chạy trên PC/Server với độ trễ thấp &amp; tự động dự phòng nếu mất mạng.
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
    padding: 18,
  },
  card: {
    width: '100%',
    maxHeight: '90%',
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
    marginBottom: 14,
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
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
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
    marginBottom: 14,
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
  editIpBtn: {
    padding: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  ipEditorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
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
  list: {
    gap: 10,
  },
  voiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 12,
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
    fontSize: 14,
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
  tagKokoro: {
    backgroundColor: 'rgba(17, 138, 178, 0.2)',
  },
  tagKokoroText: {
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
    marginTop: 3,
    lineHeight: 15,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
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
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  noticeText: {
    fontSize: 10.5,
    color: Colors.textMuted,
    flex: 1,
  },
});
