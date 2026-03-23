/**
 * 📨 EventBus
 * Lightweight topic + type pub/sub bus for AutoGen-style agent communication.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.topicSubscribers = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.typeSubscribers = new Map();
    /** @type {Map<string, Array<object>>} */
    this.history = new Map();
  }

  /**
   * Subscribe to a specific topic.
   * @param {string} topic
   * @param {(message: object) => void|Promise<void>} handler
   * @returns {() => void} unsubscribe function
   */
  subscribe(topic, handler) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('EventBus.subscribe requires a non-empty topic string');
    }
    if (typeof handler !== 'function') {
      throw new Error('EventBus.subscribe requires a handler function');
    }

    if (!this.topicSubscribers.has(topic)) {
      this.topicSubscribers.set(topic, new Set());
    }
    const set = this.topicSubscribers.get(topic);
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) this.topicSubscribers.delete(topic);
    };
  }

  /**
   * Subscribe to a message type across all topics.
   * @param {string} messageType
   * @param {(message: object, topic: string) => void|Promise<void>} handler
   * @returns {() => void} unsubscribe function
   */
  subscribeType(messageType, handler) {
    if (!messageType || typeof messageType !== 'string') {
      throw new Error('EventBus.subscribeType requires a non-empty messageType string');
    }
    if (typeof handler !== 'function') {
      throw new Error('EventBus.subscribeType requires a handler function');
    }

    if (!this.typeSubscribers.has(messageType)) {
      this.typeSubscribers.set(messageType, new Set());
    }
    const set = this.typeSubscribers.get(messageType);
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) this.typeSubscribers.delete(messageType);
    };
  }

  /**
   * Publish a message to a topic.
   * @param {string} topic
   * @param {object} message
   * @returns {Promise<{ delivered: number, message: object }>} delivery metadata
   */
  async publish(topic, message) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('EventBus.publish requires a non-empty topic string');
    }

    const normalized = this.normalizeMessage(message, topic);

    if (!this.history.has(topic)) {
      this.history.set(topic, []);
    }
    this.history.get(topic).push(normalized);

    const handlers = [
      ...(this.topicSubscribers.get(topic) || []),
      ...(this.typeSubscribers.get(normalized.type) || []),
    ];

    let delivered = 0;
    for (const handler of handlers) {
      await handler(normalized, topic);
      delivered++;
    }

    return { delivered, message: normalized };
  }

  /**
   * Publish based on message.type as the topic.
   * @param {object} message
   */
  async publishTyped(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('EventBus.publishTyped requires a message object');
    }
    if (!message.type) {
      throw new Error('EventBus.publishTyped requires message.type');
    }
    return this.publish(message.type, message);
  }

  /**
   * Get message history for topic.
   * @param {string} topic
   * @returns {Array<object>}
   */
  getHistory(topic) {
    return [...(this.history.get(topic) || [])];
  }

  /** Reset subscribers + history. */
  clear() {
    this.topicSubscribers.clear();
    this.typeSubscribers.clear();
    this.history.clear();
  }

  normalizeMessage(message = {}, topic = 'default') {
    if (typeof message !== 'object' || message === null) {
      throw new Error('EventBus message must be an object');
    }

    return {
      type: message.type || topic,
      source: message.source || 'unknown',
      target: message.target,
      content: message.content ?? '',
      metadata: message.metadata || {},
      timestamp: message.timestamp || new Date().toISOString(),
    };
  }
}

export default EventBus;
