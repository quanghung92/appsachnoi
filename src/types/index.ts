export interface Chapter {
  id: string;
  title: string;
  duration?: string;
  content: string;
  chapterNumber?: number;
  url?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  coverUrl: string;
  driveUrl?: string;
  driveId?: string;
  sourceUrl?: string;
  type: 'drive_book' | 'web_novel' | 'custom_url' | 'local_file';
  chapters: Chapter[];
  rating?: number;
  listenCount?: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  locale: string;
  description: string;
  sampleText: string;
}

export interface PlaybackState {
  currentBook: Book | null;
  currentChapter: Chapter | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
  voice: VoiceOption;
  sleepTimerMinutes: number | null;
  sleepTimerEndTime: number | null;
}
