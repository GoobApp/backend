export default interface ChatMessage {
  userDisplayName: string;
  userProfilePicture: string;
  userID: number;
  messageContent: string;
  messageTime: Date;
  messageId: number;
}
