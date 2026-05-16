// Copyright (c) 2026 NoHungryPets
// NoHungryPets - Firebase Messaging

// Import Firebase from auth.js where it's already initialized
// We'll use the existing db and auth instances

// Messaging functions

/**
 * Get or create a conversation between two users
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID
 * @param {string|null} listingId - Optional related listing ID
 * @param {string|null} listingName - Optional related listing name
 * @returns {Promise<string>} Conversation ID
 */
async function getOrCreateConversation(userId1, userId2, listingId = null, listingName = null) {
  // Ensure consistent ordering for conversation ID
  const [smallerId, largerId] = [userId1, userId2].sort();
  const conversationId = `${smallerId}_${largerId}`;

  try {
    // Check if conversation already exists
    const conversationDoc = await db.collection('conversations').doc(conversationId).get();

    if (conversationDoc.exists) {
      // Update listing info if provided and different
      if (listingId || listingName) {
        const updateData = {};
        if (listingId) updateData.relatedListingId = listingId;
        if (listingName) updateData.relatedListingName = listingName;

        if (Object.keys(updateData).length > 0) {
          await db.collection('conversations').doc(conversationId).update(updateData);
        }
      }
      return conversationId;
    } else {
      // Create new conversation
      await db.collection('conversations').doc(conversationId).set({
        participants: [userId1, userId2],
        lastMessage: '',
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        unreadCount: {
          [userId1]: 0,
          [userId2]: 0
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        relatedListingId: listingId || null,
        relatedListingName: listingName || null
      });

      return conversationId;
    }
  } catch (error) {
    console.error('Error getting/creating conversation:', error);
    throw error;
  }
}

/**
 * Send a message in a conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} senderId - Sender's user ID
 * @param {string} text - Message text
 * @returns {Promise<void>}
 */
async function sendMessage(conversationId, senderId, text) {
  if (!text.trim()) {
    throw new Error('Message cannot be empty');
  }

  try {
    // Add message to subcollection
    const messageRef = await db.collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .add({
        senderId: senderId,
        text: text.trim(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false
      });

    // Update conversation metadata
    await db.collection('conversations').doc(conversationId).update({
      lastMessage: text.trim(),
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Increment unread count for the other participant
    const conversationDoc = await db.collection('conversations').doc(conversationId).get();
    if (conversationDoc.exists) {
      const participants = conversationDoc.data().participants || [];
      const otherParticipantId = participants.find(id => id !== senderId);

      if (otherParticipantId) {
        await db.collection('conversations').doc(conversationId).update({
          [`unreadCount.${otherParticipantId}`]: firebase.firestore.FieldValue.increment(1)
        });
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

/**
 * Subscribe to conversations for a user
 * @param {string} userId - User ID
 * @param {Function} callback - Callback function with conversation data
 * @returns {Function} Unsubscribe function
 */
function subscribeToConversations(userId, callback) {
  return db.collection('conversations')
    .where('participants', 'array-contains', userId)
    .orderBy('lastUpdated', 'desc')
    .onSnapshot(snapshot => {
      const conversations = [];
      snapshot.forEach(doc => {
        conversations.push({
          id: doc.id,
          ...doc.data()
        });
      });
      callback(conversations);
    });
}

/**
 * Subscribe to messages in a conversation
 * @param {string} conversationId - Conversation ID
 * @param {Function} callback - Callback function with message data
 * @returns {Function} Unsubscribe function
 */
function subscribeToMessages(conversationId, callback) {
  return db.collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      const messages = [];
      snapshot.forEach(doc => {
        messages.push({
          id: doc.id,
          ...doc.data()
        });
      });
      callback(messages);
    });
}

/**
 * Mark messages as read in a conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID marking as read
 * @returns {Promise<void>}
 */
async function markMessagesAsRead(conversationId, userId) {
  try {
    // Reset unread count for this user
    await db.collection('conversations').doc(conversationId).update({
      [`unreadCount.${userId}`]: 0
    });

    // Optionally, mark individual messages as read
    // This could be done by updating a read flag on messages
    // For simplicity, we're just managing the unread count
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw error;
  }
}

/**
 * Get conversation with another user
 * @param {string} userId - Current user ID
 * @param {string} otherUserId - Other user ID
 * @returns {Promise<Object|null>} Conversation data or null
 */
async function getConversationWithUser(userId, otherUserId) {
  const [smallerId, largerId] = [userId, otherUserId].sort();
  const conversationId = `${smallerId}_${largerId}`;

  try {
    const conversationDoc = await db.collection('conversations').doc(conversationId).get();
    if (conversationDoc.exists) {
      return {
        id: conversationDoc.id,
        ...conversationDoc.data()
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting conversation:', error);
    return null;
  }
}

// Export functions for use in other files
window.messaging = {
  getOrCreateConversation,
  sendMessage,
  subscribeToConversations,
  subscribeToMessages,
  markMessagesAsRead,
  getConversationWithUser
};