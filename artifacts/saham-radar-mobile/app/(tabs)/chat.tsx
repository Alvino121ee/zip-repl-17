import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useSendAiChat } from '@workspace/api-client-react';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  'Saham apa yang bagus hari ini?',
  'Analisis BBCA',
  'Sektor apa yang prospektif?',
  'Kondisi IHSG sekarang?',
];

const INITIAL_MESSAGE: Message = {
  id: 'init',
  role: 'ai',
  content: 'Halo! Saya SahamRadar AI. Tanya saya tentang saham BEI, kondisi pasar, atau strategi investasi.',
  timestamp: new Date(),
};

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : 0;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const listRef = useRef<FlatList>(null);

  const sendChat = useSendAiChat();

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText('');

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setIsTyping(true);

    try {
      const result = await sendChat.mutateAsync({ data: { message: trimmed } });
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: result.reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } catch {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: 'Maaf, terjadi kesalahan. Coba lagi.',
        timestamp: new Date(),
      };
      setMessages((prev) => [errMsg, ...prev]);
    } finally {
      setIsTyping(false);
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={[styles.avatar, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>AI</Text>
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isUser
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isUser ? colors.primaryForeground : colors.foreground },
            ]}
          >
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={[styles.onlineDot, { backgroundColor: colors.positive }]} />
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>AI Analyst</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Powered by DeepSeek
          </Text>
        </View>
      </View>

      {/* Messages (inverted FlatList) */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        inverted
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          isTyping ? (
            <View style={[styles.typingRow]}>
              <View style={[styles.avatar, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>AI</Text>
              </View>
              <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            </View>
          ) : null
        }
      />

      {/* Quick Prompts */}
      {messages.length === 1 && !isTyping && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={QUICK_PROMPTS}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.quickList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.quickChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => sendMessage(item)}
            >
              <Text style={[styles.quickText, { color: colors.mutedForeground }]}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Input */}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + bottomPad + 8,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
          ]}
          placeholder="Tanya tentang saham BEI..."
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => sendMessage(inputText)}
          returnKeyType="send"
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: inputText.trim() ? colors.primary : colors.card },
          ]}
          onPress={() => sendMessage(inputText)}
          disabled={!inputText.trim() || isTyping}
        >
          <Feather name="send" size={18} color={inputText.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 12 },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 10,
  },
  msgRowUser: { flexDirection: 'row-reverse' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 10,
  },
  quickList: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    maxHeight: 100,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
