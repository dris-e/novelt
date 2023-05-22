const mongoose = require("mongoose");

const chatboardSchema = new mongoose.Schema({
    name: { type: String, unique: true },
    creator: String,
    description: String,
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chat" }],
    timestamp: String,
    username: Boolean,
    private: Boolean,
    pass: String
});

const Chatboard = mongoose.model("Chatboard", chatboardSchema);

module.exports = Chatboard;