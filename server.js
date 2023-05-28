const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const bcrypt = require("bcrypt");
const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const bodyParser = require("body-parser");
const Chat = require("./models/Chat");
const Chatboard = require("./models/Chatboard");

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50000 * 1000
    }
});
require("dotenv").config();

let targetTime = 0; //12 am cdt
let nextReset;

//add reactions x
//MESSAGES UPDATE LIVE x (fixed)
//messages delete every 24 hours x
//chatboard description? (probably) x
//private chatboards, enable/disable usernames x
//synchoronized timer x
//shows first ~10 other is scroll
//add replies x
//REPLIES VIEW COUNT DO NOT WORK!!! x (no longer here)
//sort by latest/most popular x
//image upload x (DOES NOT WORK ON SERVER, USE AWS)
//links/routes for every chatboard (if not cookies to last chatboard)
//save last chatboard user was on in cookies
//same timezone everywhere
//allow all file types and sort content by filetype

//optimization
//dont load and empty messages x
//store ip as first 10 digits of hash x
//show trending messages on homepage
//load first 10 on scroll
//show one at a time, similar to tiktok x?

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3003;

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("mongodb connected"))
    .catch((err) => console.error("error connecting -", err));

cron.schedule(`0 ${targetTime} * * *`, async () => {
    deleteMsgs(); //go here if edit msg
    }, {
        timezone: "America/Chicago"
});

async function deleteMsgs() {
    const messages = await Chat.find();

    for (const msg of messages) { //edit this too if edit chat
        msg.username = "";
        msg.message = "";
        msg.reactions = [];
        msg.image = Buffer.alloc(0);
        msg.imageMime = "";
        msg.color = "";
        msg.timestamp = null;
        msg.replies = [];
        await msg.save();
    }
    console.log("message is kil");
    io.emit("reloadMessages", messages);

    try {
        const dir = "./uploads";
        const files = await fs.readdir(dir);
        const deleteProms = files.map(filename => fs.unlink(path.join(dir, filename)));
        await Promise.all(deleteProms);
        console.log("image is kil");
    } catch (error) {
        console.log("oops", error);
    }

    //delete chatbaorsd (for testigm ONLY!)
    // Chatboard.deleteMany({}, function(err) { 
    //     if (err) console.log(err);
    //     console.log("cahtboard is kil");
    // });
}

//run for testing only
// deleteMsgs();

setInterval(() => {
    const nowDate = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false });
    const now = new Date(nowDate);
    const targetDate = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false });
    const target = new Date(targetDate);
    target.setHours(0, targetTime, 0);

    if (now > target) {
        target.setDate(target.getDate() + 1);
    }
    
    const diff = target - now;
    nextReset = {
        hours: (Math.floor(diff / 1000 / 60 / 60)).toString().padStart(2, "0"),
        mins: (Math.floor(diff / 1000 / 60) % 60).toString().padStart(2, "0"),
        secs: (Math.floor(diff / 1000) % 60).toString().padStart(2, "0")
    }
    
    io.emit("updateTimer", nextReset);
}, 1000);

function hashKey(key) {
    const hash = crypto.createHash("sha256");
    return hash.update(key).digest("hex");
}

app.use(express.static(path.join(__dirname, ".")));
app.use("/uploads", express.static("uploads"));
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).send({ message: "file too big make smaller (max is 2mb)" });
    } else {
        next(err);
    }
});
app.use(bodyParser.json());

// app.get("/chatboard/:chatboardName", (req, res) => {
//     const chatboardName = req.params.chatboardName;

//     res.sendFile(path.join(__dirname, "index.html"));
// });

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// app.get("/chatboard/styles.css", (req, res) => {
//     res.sendFile(path.join(__dirname, "styles.css"), { headers: { "Content-Type": "text/css"} })
// });

app.get("/download/:file(*)", async (req, res) => {
    const file = req.params.file;
    const message = await Chat.findOne({ _id: file });

    if (message) {
        const image = message.image;
        const imageMime = message.imageMime;
        if (image && imageMime) {
            res.set("Content-Type", imageMime);
            res.send(image);
        } else {
            return res.status(404).send({ message: "file not treal" });
        }
    }
});

app.post("/createChatboard", async (req, res) => {
    const { name, description, username, private, pass } = req.body;
    const dehashIP = req.headers["x-forwarded-for"] || req.ip;
    const ip = hashKey(dehashIP).substring(0, 8);

    if (!name.trim()) {
        return res.status(400).json({ message: "chatboard name cant be empty" });
    }
    
    const exists = await Chatboard.findOne({ name });
    if (exists) {
        return res.status(400).json({ message: "chatboard alr exists" });
    }

    let hashedPass = null;
    if (private) {
        hashedPass = await bcrypt.hash(pass, 10);
    }

    const chatboard = new Chatboard({ //edit if edit chatboard
        name,
        description, 
        creator: `#${ip.substring(0, 6)}`,
        messages: [],
        timestamp: new Date(),
        username,
        private,
        pass: hashedPass
    });

    console.log(private);
    await chatboard.save();
    const link = `http://localhost:3030/${chatboard.name}`; //replace in future
    res.status(201).send({ ...chatboard._doc, link });
});

app.post("/postMessage/:chatboardName", upload.single("image"), async (req, res) => {
    const chatboardName = req.params.chatboardName;
    console.log(chatboardName);
    const { message, username, reactions } = req.body;
    const { file } = req;
    const dehashIP = req.headers["x-forwarded-for"] || req.ip;
    const ip = hashKey(dehashIP).substring(0, 8);
    const chatboard = await Chatboard.findOne({ name: chatboardName });

    if (chatboard) { //edit this if edit chat
        let newUsername = chatboard.username ? "Anonymous" : username;
        const chatMessage = new Chat({
            username: newUsername,
            message,
            reactions,
            image: null,
            imageMime: null,
            views: 0,
            color: `#${ip.substring(0, 6)}`,
            timestamp: new Date(),
            replies: [],
            viewed: []
        });
        if (file) {
            const compressedBuffer = await sharp(file.buffer)
            .resize(500)
            .jpeg({ quality: 50 })
            .jpeg({ quality: 50 })
            .png({ quality: 50 })
            .webp({ quality: 50 })
            .toBuffer();

            chatMessage.image = compressedBuffer;
            chatMessage.imageMime = file.mimetype;
        }
        await chatMessage.save();
        chatboard.messages.push(chatMessage);
        await chatboard.save();

        io.emit("newMessage", { chatboard, chatboardName });
        res.status(201).send(chatMessage);
    } else {
        res.status(404).send({ message: "chatboard not found" });
    }
});

app.post("/addReply/:chatId/:boardName?", async (req, res) => {
    const chatId = req.params.chatId;
    const boardName = req.params.boardName;
    const { user, newMsg } = req.body;
    const dehashIP = req.headers["x-forwarded-for"] || req.ip;
    const ip = hashKey(dehashIP).substring(0, 8);

    const reply = { 
        username: user, 
        message: newMsg, 
        reactions: [], 
        image: "", 
        color: `#${ip.substring(0, 6)}`,
        timestamp: new Date(),
        viewed: []
    }
    const chat = await Chat.findOne({ _id: chatId });
    const board = await Chatboard.findOne({ name: boardName });

    if (chat) {
        chat.replies.push(reply);
        await chat.save();

        io.emit("newReply", { chat, board });
        res.status(200).send(chat);
    } else {
        res.status(404).send({ message: "message not found" });
    }
});

app.post("/addReaction/:chatId", async (req, res) => {
    const chatId = req.params.chatId;
    const { emoji } = req.body;
    const dehashIP = req.headers["x-forwarded-for"] || req.ip;
    const ip = hashKey(dehashIP).substring(0, 8);
    const message = await Chat.findOne({ _id: chatId });

    if (message) {
        const existingReaction = message.reactions.find(reaction => reaction.reacted === ip);

        if (existingReaction) {
            existingReaction.emoji = emoji;
        } else {
            message.reactions.push({
                emoji,
                reacted: ip
            });
        }
        await message.save();

        io.emit("newReaction", { chatId, newMessage: message });
        res.status(200).send(message);
    } else {
        return res.status(404).send({ message: "message not found" });
    }
});

app.post("/verifyPassword", async (req, res) => {
    const { name, pass } = req.body;
    const chatboard = await Chatboard.findOne({ name });
    if (!chatboard || !chatboard.private) {
        return res.status(400).json({ message: "chatboard not found or not private "});
    }

    const match = await bcrypt.compare(pass, chatboard.pass);
    if (match) {
        res.status(200).send({ message: "good" });
    } else {
        res.status(400).send({ message: "bad" });
    }
});

app.get("/getChatboards/:sort/:skip?", async (req, res) => {
    const sort = req.params.sort || "popularity";
    const skip = req.params.skip ? parseInt(req.params.skip) : 0;
    let sortOption = {};

    if (sort === "latest") {
        sortOption = { timestamp: -1 } ;
    } else if (sort === "popularity") {
        sortOption = { totalViews: -1 }
    }
    const chatboards = await Chatboard.find().populate({
        path: "messages",
        options: { sort: { views: -1 } }
    }).sort(sortOption);
    // .skip(skip)
    // .limit(10); //change if more

    const newChatboards = chatboards.map(chatboard => {
        let totalViews = 0;
        let totalImages = 0;
        const validMessages = chatboard.messages.filter(message => message !== "");
        chatboard.messages.forEach(message => {
            totalViews += message.views;
            totalImages += message.imageMime ? 1 : 0;
        });

        chatboard.popularityScore = (totalViews || 1) * (totalImages || 1) * (validMessages.length || 1);

        return { ...chatboard._doc, totalViews, popularityScore: chatboard.popularityScore };
    });

    if (sort === "popularity") {
        newChatboards.sort((a, b) => b.popularityScore - a.popularityScore);
    } else if (sort === "latest") {
        newChatboards.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    res.json(newChatboards);
});

app.get("/searchChatboard/:name", async (req, res) => {
    const name = req.params.name;
    const chatboard = await Chatboard.findOne({ name }).populate("messages");

    if (chatboard) {
        res.send(chatboard);
    } else {
        res.status(404).send({ message: "chatboard not found" });
    }
});

app.get("/messages/:chatboardName/:sort?", async (req, res) => {
    const chatboardName = req.params.chatboardName;
    const sort = req.params.sort || "popularity";

    const chatboard = await Chatboard.findOne({ name: chatboardName }).populate("messages");

    if(chatboard) {
        const dehashIP = req.headers["x-forwarded-for"] || req.ip;
        const ip = hashKey(dehashIP).substring(0, 8);
        const messages = chatboard.messages;

        messages.forEach(async (message) => {
            if (!message.viewed.includes(ip) && message.message !== "") {
                message.viewed.push(ip);
                message.views++;
                message.color = `#${ip.substring(0, 6)}`;
                // for (let reply of message.replies) {
                //     if (!reply.viewed.includes(ip)) {
                //         reply.viewed.push(ip);
                //         reply.views++;
                //         console.log(ip, reply.views);
                //     }
                // }
                await message.save();
            }
            message.popularityScore = (message.views || 1) * (message.reactions.length || 1) * (message.replies.length || 1) * (message.imageMime ? 2 : 1);
        });

        if (sort === "popularity") {
            messages.sort((a, b) => b.popularityScore - a.popularityScore);
        } else if (sort === "latest") {
            messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }

        res.json(messages);
    } else {
        res.status(404).send({ message: "chatboard not found" });
    }
});

io.on("connection", (socket) => {
    console.log("user connected");

    // socket.on("sendMessage", async (msg) => {
    //     let message = new Chat(msg);
    //     await message.save();
    //     io.emit("newMessage", msg);
    // });

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });
});

server.listen(port, () => {
    console.log(`server listening on port ${port}`);
});




// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, "uploads/");
//     },
//     filename: (req, file, cb) => {
//         cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
//     }
// });
// const upload = multer({ 
//     storage: storage,
//     fileFilter: (req, file, cb) => {
//         const filetypes = /jpeg|jpg|png|webp|heic|gif|pdf/;
//         const extname = filetypes.test(path.extname(file.originalname).toLowerCase()); // what a safe and non expolituable way of chcecking file types
//         const mimetype = filetypes.test(file.mimetype);

//         if (mimetype && extname) {
//             return cb(null, true);
//         }
//         cb(`only uplaod these files thajnks ${filetypes}`);
//     },
//     limits: {
//         fileSize: 2000 * 1000
//     }
// });


// app.get("/messages/:chatboardName", async (req, res) => {
//     const ip = req.headers["x-forwarded-for"] || req.ip;
//     const messages = await Chat.find();

//     messages.forEach(async (message) => {
//         if (!message.viewed.includes(ip)) {
//             message.viewed.push(ip);
//             message.views++;
//             await message.save();
//         }
//     });
//     res.json(messages);
// });

// fetch("/messages")
//         .then(response => response.json())
//         .then(data => {
//             for (let msg of data) {
//                 addMessageToList(msg);
//             }
//         });

//         send.addEventListener("click", () => { //edit this if edit chat too
//             let text = input.value;
//             let name = username.value != "" ? username.value : "Anonymous";
//             const message = {
//                 username: name,
//                 message: text,
//                 views: 0,
//                 timestamp: new Date(),
//                 viewed: []
//             }
//             socket.emit("sendMessage", message);
//             input.value = "";
//         });



// app.get("/recieve", async (req, res) => {
//     let text = await Chat.findOne();
//     if (!text) {
//         text = new Chat({ message: "yes"});
//         await text.save();
//     }
//     res.json({ message: text.message });
// });

// app.post("/send", async (req, res) => {
//     let text = await Chat.findOne();
//     if (!text) {
//         text = new Chat({ message: "yes" });
//         await text.save();
//     }
//     text.message = "no";
//     await text.save();
//     io.emit("newMessage", { message: text.message });
//     res.json({ message: text.message });
// });

        // async function getMessage() {
        //     const response = await fetch("/recieve");
        //     const data = await response.json();
        //     myText.textContent = `${data.message}`;
        // }

        // async function sendMessage() {
        //     const response = await fetch("/send", { method: "POST" });
        //     const data = await response.json();
        //     myText.textContent = `${data.message}`;
        // }