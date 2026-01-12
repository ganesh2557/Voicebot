
export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: number;
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export enum BotStatus {
  DISCONNECTED = 'Disconnected',
  CONNECTING = 'Connecting...',
  IDLE = 'Listening',
  THINKING = 'Thinking',
  SPEAKING = 'Speaking',
  ERROR = 'Error'
}
