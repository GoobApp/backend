export default interface ChatMessage {
  userDisplayName: string;
  userProfilePicture: string;
  userUUID: string;
  messageContent: string;
  messageTime: Date;
  messageId: number;
  isEdited: false;
}