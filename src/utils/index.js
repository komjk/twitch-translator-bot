const config = require('../config');

// Debug helper
const debug = (message) => {
  if (config.DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
};

// Normalize channel name
const normalizeChannelName = (channelName) => {
  return channelName.startsWith('#') 
    ? channelName.substring(1).toLowerCase() 
    : channelName.toLowerCase();
};

// Sanitize text to prevent injection
const sanitizeText = (text) => {
  if (!text) return '';
  
  // Remove control characters and normalize
  let sanitized = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // control chars
    .trim();
  
  // Prevent Twitch command injection
  sanitized = sanitized.replace(/^[\/\.]\w+\s*/i, '');
  
  return sanitized;
};

// Check if a word is an emote (surrounded by colons)
const isEmote = (word) => {
  return /^:[a-zA-Z0-9_]+:$/.test(word);
};

// Process emotes in a message
const processEmotes = (message) => {
  if (!message) return { processed: '', hasEmotes: false, emotes: [] };
  
  const words = message.split(/\s+/);
  const emotes = [];
  let hasEmotes = false;
  
  // Process each word to identify emotes
  const processedWords = words.map(word => {
    if (isEmote(word)) {
      hasEmotes = true;
      emotes.push(word);
      return '{EMOTE}'; // Replace with placeholder
    }
    return word;
  });
  
  return {
    processed: processedWords.join(' '),
    hasEmotes,
    emotes
  };
};

// Check for inappropriate content
const isInappropriateMessage = (message) => {
  if (!message) return true;
  
  // Very basic filter for obviously inappropriate content
  const inappropriatePatterns = [
    /\bn[i1l]gg[e3]r/i,  // racial slur
    /\bf[a@]gg[o0]t/i,   // homophobic slur
    /\bc[u\*]nt/i,       // misogynistic slur
    /\bk[i1]k[e3]/i,     // antisemitic slur
    /\br[e3]t[a@]rd/i,   // ableist slur
  ];
  
  return inappropriatePatterns.some(pattern => pattern.test(message));
};

// Check if message is too long
const isMessageTooLong = (message) => {
  return message && message.length > config.MAX_MESSAGE_LENGTH;
};

module.exports = {
  debug,
  normalizeChannelName,
  sanitizeText,
  isEmote,
  processEmotes,
  isInappropriateMessage,
  isMessageTooLong
}; 