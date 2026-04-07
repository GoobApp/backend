export default interface ChatMessage {
  userDisplayName: string;
  userProfilePicture: string;
  userUUID: string;
  userRole: string | null;
  messageContent: string;
  messageImageUrl: string;
  messageTime: Date;
  messageId: number;
  isEdited: boolean;
  replyingTo: number | null;
  isReply: boolean;
}
