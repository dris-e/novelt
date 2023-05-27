const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
    username: String,
    message: String,
    reactions: [{
        emoji: String,
        reacted: String 
    }],
    image: Buffer,
    imageMime: String,
    views: Number,
    color: String,
    timestamp: String,
    replies: [{
        username: String,
        message: String,
        reactions: [{
            emoji: String,
            reacted: String 
        }],
        image: String,
        color: String,
        timestamp: String,
        viewed: [String]
    }],
    viewed: [String]
});

const Chat = mongoose.model("Chat", chatSchema);

module.exports = Chat;