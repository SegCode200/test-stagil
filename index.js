const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
// const ngrok = require("ngrok");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const dotenv = require("dotenv")
dotenv.config()

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const users = {};
app.use(bodyParser.json());

const fcmTokens = {
  users: {},
  stores: {},
};

const userApp = admin.initializeApp(
  {
    credential: admin.credential.cert(require(process.env.USER_GOOGLE_APPLICATION_CREDENTIALS)),
  },
  "userApp"
);

const storeApp = admin.initializeApp(
  {
    credential: admin.credential.cert(require(process.env.STORE_GOOGLE_APPLICATION_CREDENTIALS)),
  },
  "storeApp"
);
const sendNotification = async ({ toUserId, from, offer, targetType }) => {
  const payload = {
    data: {
      type: "INCOMING_CALL",
      from,
      offer: JSON.stringify(offer),
    },
    android: {
      priority: "high",
    },
  };

  try {
    let token;
    let app;
    if (targetType === "user") {
      token = fcmTokens.users[toUserId];
      app = admin.app("userApp");
    } else if (targetType === "store") {
      token = fcmTokens.stores[toUserId];
      app = admin.app("storeApp");
    }

    if (!token) {
      console.log("No FCM token for:", toUserId);
      return;
    }

    await app.messaging().send({ token, ...payload });
    console.log("Notification sent to:", toUserId);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
};
app.post("/register-token", (req, res) => {
  const { userId, token, type } = req.body; // type: "user" | "store"

  if (!userId || !token || !type) {
    return res.status(400).send("Missing userId, token or type");
  }

  if (type === "user") {
    fcmTokens.users[userId] = token;
  } else if (type === "store") {
    fcmTokens.stores[userId] = token;
  }

  console.log(`Registered token for ${type}: ${userId}`);
  res.status(200).send("Token registered");
});

io.on("connection", (socket) => {
  console.log("User connected: ", socket.id);

  socket.on("register", (userId) => {
    users[userId] = socket.id;
    console.log(`${userId} registered with socket ${socket.id}`);
  });

  socket.on("call", async({ to, offer, from }) => {
    const targetSocket = users[to];
        if (targetSocket) {
      io.to(targetSocket).emit("incoming-call", { from, offer });
    } 
  });

  socket.on("answer", ({ to, answer }) => {
    const targetSocket = users[to];
    if (targetSocket) {
      io.to(targetSocket).emit("call-answered", { answer });
    }
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    const targetSocket = users[to];
    if (targetSocket) {
      io.to(targetSocket).emit("ice-candidate", { candidate });
    }
  });

  socket.on("end-call", ({ to }) => {
    const targetSocket = users[to];
    if (targetSocket) {
      io.to(targetSocket).emit("call-ended");
    }
  });
  socket.on("reject-call", ({ to }) => {
    const targetSocket = users[to];
    if (targetSocket) {
      io.to(targetSocket).emit("call-rejected");
    }
  });

  socket.on("disconnect", () => {
    for (const userId in users) {
      if (users[userId] === socket.id) {
        delete users[userId];
        break;
      }
    }
    console.log("User disconnected: ", socket.id);
  });
});

server.listen(5000, () => console.log("Signaling server running on port 5000"));

// ngrok
//   .connect(5000)
//   .then((tunnel) => {
//     console.log("Ngrok tunnel is connected to ", tunnel);
//   })
//   .catch((error) => {
//     console.log("Error ocurred", error);
//   });
