const { EventEmitter } = require('events');

// Simple in-process event bus used to bridge controller actions to Socket.IO.
// For production, replace with Redis/pubsub or message queue.
module.exports = new EventEmitter();

