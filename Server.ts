import express, { Application, Request, Response, NextFunction } from "express";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { MainApp } from "./App";
import helmet from "helmet";
dotenv.config();
import cron from "node-cron";
import { ProcessStorePayments } from "../Auth/AdminAuth";
import axios from "axios";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { db } from "../Database/StoreDB";
import { DateTime } from "luxon";
import { sendPushChatNotification, sendPushNotification } from "../Utils/Notifications";
import {
  sendCallNotification,
  sendChatNotification,
  sendHangUpNotification,
} from "../Utils/FirebaseNotifications";
import {
  sendCallNotificationStoreManager,
  sendChatNotificationStoreManager,
  sendHangUpNotificationStoreManager,
} from "../Utils/FirebaseNotificationStore";

const port: number = parseInt(process.env.PORT!) || 9010;
const app: Application = express();

app.use(
  cors({
    origin: "*", // Allow all origins
    credentials: true, // Allow cookies and authentication headers
  })
);

app.use(express.json());

MainApp(app);
app.use(morgan("combined"));

app.use(cookieParser());
app.use(helmet());

app.use(express.urlencoded({ extended: true }));
const server = createServer(app);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});
interface Imessage {
  id: string;
  chatId: string;
  senderId: string;
  senderType: "StoreManager" | "User" | "Rider";
  content: string;
  createdAt: string;
  orderId?: string | null;
}

cron.schedule("0 * * * *", async () => {
  console.log("Running ProcessStorePayments cron job...");
  try {
    const req = {} as Request;
    const res = {
      status: (code: number) => ({
        json: (data: any) => console.log(`Response: ${JSON.stringify(data)}`),
      }),
    } as unknown as Response;
    const next = (err?: any) => {
      if (err) console.error(`Error: ${err.message}`);
    };

    // Call the function
    await ProcessStorePayments(req, res, next);
  } catch (error) {
    console.error("Error in cron job:", error);
  }
});
cron.schedule("*/10 * * * *", async () => {
  console.log("Cron job started - Hitting the server");
  try {
    const response = await axios.get(
      "https://stagilstore-1-1.onrender.com/api/store/get-all-store"
    );
  } catch (error: any) {
    console.error("Error hitting the server:", error.message);
  }
});

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log("APP is ready ✅⭐");
  // console.log(req.headers);
  next();
});

server.listen(port, () => {
  console.clear();
  console.log();
  console.clear();
  console.log(`Server is running on http://localhost:${port} 💥🚀⭐⚡`);
  console.log("db connected...🔥🔥🔥");
});
io.on("connection", (socket) => {
  // console.log(`Socket connected: ${socket.id}`);

  socket.on("joinRoom", ({ chatId }) => {
    socket.join(chatId);
    // console.log(`Socket ${socket.id} joined room: ${chatId}`);
  });
  socket.on("register", (userId: string) => {
    socket.join(userId); // Join room with userId for direct messaging
    console.log(`User registered: ${userId} with socket ID: ${socket.id}`);
  });
  // Delegate chat handling
  socket.on(
    "sendMessage",
    async ({ chatId, senderId, senderType, content, orderId }) => {
      try {
        const chat = await db.chat.findUnique({ where: { id: chatId } });
        if (!chat) {
          console.error(`sendMessage: Chat not found for id: ${chatId}`);
          return;
        }
        const timeZoneDate =
          chat.TimeZone === null
            ? DateTime.now().setZone(chat?.TimeZone)
            : DateTime.now();

        // Convert to ISO-8601 format without milliseconds
        const isoString = timeZoneDate.toISO({ suppressMilliseconds: true });
        const tempMessage: Imessage = {
          id: crypto.randomUUID(), // or generate one yourself
          chatId,
          senderId,
          senderType: senderType === "StoreManager" ? "StoreManager" : senderType === "User" ? "User" : "Rider",
          content,
          createdAt: isoString as string,
          orderId: orderId || null,
        };
        io.to(chatId).emit("newMessage", tempMessage);
        (async () => {
          const savedMessage = await db.message.create({ data: tempMessage });
          const assignedRiderOrder = await db.order.findUnique({
            where: { id: orderId || "" },})

          if (senderType === "User") {
            const store = await db.store.findUnique({
              where: {
                id: chat?.storeId as string,
                
              },
            });
            const storeManager: any = await db.storeManager.findUnique({
              where: {
                id: store?.storeManagerId,
              },
            });
            if (!store || !storeManager.notificationToken || !storeManager) {
              console.error(`User not found for id: ${senderId}`);
              return;
            }
            const response = await sendChatNotificationStoreManager(
              storeManager.notificationToken,
              content,
              storeManager
            );
            if( !assignedRiderOrder?.assignedRiderId){
              console.error(`Assigned Rider not found for order id: ${orderId}`);
              return;
            }else{
                const rider = await db.rider.findFirst({
              where: { id: chat?.riderId as string },
            })
               if(!rider || !rider.notificationToken ){
              console.error(`Rider not found for id: ${chat?.riderId}`);
              return;
            }else{
              sendPushChatNotification(rider.notificationToken, 'New Message', content, { chatId, senderId, senderType });
            }
              
            }
             
      
          }
          if (senderType === "StoreManager") {
            const user = await db.user.findUnique({
              where: { id: chat?.userId },
            });
            if (!user || !user.notificationToken) {
              console.error(`User not found for id: ${senderId}`);
              return;
            }
             await sendChatNotification(
              user.notificationToken,
              content,
              user
            );
               if( !assignedRiderOrder?.assignedRiderId){
              console.error(`Assigned Rider not found for order id: ${orderId}`);
              return;
            }else{
                const rider = await db.rider.findFirst({
              where: { id: chat?.riderId as string },
            })
               if(!rider || !rider.notificationToken ){
              console.error(`Rider not found for id: ${chat?.riderId}`);
              return;
            }else{
              sendPushChatNotification(rider.notificationToken, 'New Message', content, { chatId, senderId, senderType });
            }
              
            }
            
          }
          if (senderType === "Rider") {
            const user = await db.user.findUnique({
              where: { id: chat?.userId },
            });
              const store = await db.store.findUnique({
              where: {
                id: chat?.storeId as string,
                
              },
            });
                 const storeManager: any = await db.storeManager.findUnique({
              where: {
                id: store?.storeManagerId,
              },
            });
            if (!user || !user.notificationToken || !store || !storeManager.notificationToken || !storeManager) {
              console.error(`User not found for id: ${senderId}`);
              return;
            }
                 
            const responses = await sendChatNotificationStoreManager(
              storeManager.notificationToken,
              content,
              storeManager
            );
            const response = await sendChatNotification(
              user.notificationToken,
              content,
              user
            );
          }
   

        })();
      } catch (error) {
        console.error("Error saving message:", error);
      }
    }
  );
  // Caller sends offer
  socket.on("typing", ({ chatId, senderId }) => {
    // Notify others in the chat
    socket.to(chatId).emit("typing", { chatId, senderId });
  });
  socket.on("stopTyping", ({ chatId, senderId }) => {
    socket.to(chatId).emit("stopTyping", { chatId, senderId });
  });
  socket.on("call-user", async ({ from, to, offer, callerName, type }) => {
    io.to(to).emit("incoming-call", { from, offer, callerName });
    if (type === "storeManager") {
      const store = await db.store.findFirst({
        where: {
          id: to,
        },
      });
      const storeManager: any = await db.storeManager.findUnique({
        where: {
          id: store?.storeManagerId,
        },
      });
      if (!store || !storeManager.notificationToken || !storeManager) {
        console.error(`User not found for id: ${to}`);
        return;
      }
      const response = await sendCallNotificationStoreManager(
        storeManager.notificationToken,
        callerName,
        to,
        offer
      );
      console.log("Push notification sent:", response);
    } else if (type === "user") {
      const user = await db.user.findUnique({ where: { id: to } });
      if (!user || !user.notificationToken) {
        console.error(`User not found for id: ${to}`);
        return;
      }
      const response = await sendCallNotification(
        user.notificationToken,
        callerName,
        to,
        offer
      );
      console.log("Push notification sent:", response);
    }
  });

  // Callee sends answer
  socket.on("answer-call", ({ to, answer }) => {
    io.to(to).emit("call-answered", { answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { candidate });
  });

  socket.on("end-call", ({ to }) => {
    io.to(to).emit("call-ended");
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} due to ${reason}`);
  });
});
// io.on("connection", (socket) => {
//     // console.log("Rider connected", socket.id);

//     socket.on("updateLocation", async ({ riderId, latitude, longitude, zipCode,country,state }) => {
//       // Save rider location
//       const rider = await db.rider.findUnique({ where: { id: riderId } });
//       if (!rider) {
//             return "Rider not found"
//       }
//       const checkRiderExistingLocation = await db.riderLocation.findUnique({ where: { id: riderId}})
//       const response = await axios.get(
//         `https://timeapi.io/api/time/current/coordinate?latitude=${latitude}&longitude=${longitude}`,
//         {
//           headers: {
//             Accept: "application/json",
//           },
//         }
//       );
//       if (!response) {
//         return "Can't time zone"
//       }
//       const TimeZone = response.data;
//       if(checkRiderExistingLocation) {
//         await db.riderLocation.update({
//           where: { id: riderId },
//           data: { latitude, longitude, zipCode,country:country,state:state,TimeZone:TimeZone?.timeZone },
//         });
//         // return "Location updated successfully"
//         io.emit(`location-update-${zipCode}`, { riderId, latitude, longitude, zipCode });
//       }else{
//        const createRiderLocation =  await db.riderLocation.create({
//           data: {
//             riderId,
//             latitude,
//             longitude,
//             zipCode,
//             country:country,
//             state:state,
//             TimeZone:TimeZone?.timeZone
//           },
//         })
//         // return createRiderLocation
//         io.emit(`createRidersLocation-${zipCode}`, { riderId, latitude, longitude, zipCode,createRiderLocation });
//       }

//       // Emit to store managers in the same zip code

//       console.log(`Updated rider ${riderId}: ${latitude}, ${longitude}, Zip: ${zipCode}`);
//     });

//     socket.on("disconnect", () => console.log("Rider disconnected"));
//   });
// io.on("connection", (socket) => {
//     console.log("User connected:", socket.id);

//     socket.on("disconnect", () => {
//     console.log("User disconnected:", socket.id);
//     for (let [key, value] of users.entries()) {
//     if (value === socket.id) {
//     users.delete(key);
//     }
//     }
//     });
//     });
process.on("uncaughtException", (error) => {
  console.log("Server is shutting downn because of uncaughtException");
  console.log(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.log("server is shutting down because of unhandledRejection");
  console.log(reason);
  server.close(() => {
    process.exit(1);
  });
});
// 📞 WebRTC signaling logic
//  socket.on("startCall", async({callId,receiverId,callerName,type}) => {
//     console.log(`Socket ${socket.id} joined call room: ${callId}`);
//     io.to(receiverId).emit("incomingCall", { callId, callerName,receiverId });
//     if(type === "user"){
//         const user = await db.user.findUnique({ where: { id: receiverId } });
//         if (!user || !user.notificationToken) {
//             console.error(`User not found for id: ${receiverId}`);
//             return;
//         }
//         const response = await sendCallNotification(user.notificationToken,callerName,callId,receiverId );
//         console.log("Push notification sent:", response)
//     }
//     if(type === "storeManager"){
//         console.log(`Store Manager socket joined call room: ${receiverId}`);
//         const store = await db.store.findFirst({where:{
//             id: receiverId
//           }})
//           const storeManager:any = await db.storeManager.findUnique({
//             where:{
//                 id:store?.storeManagerId
//             }
//           })
//           if (!store || !storeManager.notificationToken || !storeManager) {
//             console.error(`User not found for id: ${receiverId}`);
//             return;
//         }
//         const response = await sendCallNotificationStoreManager(storeManager.notificationToken,callerName,callId,receiverId );
//         console.log("Push notification sent:", response)

//     }
// });
// socket.on("hangupCall", async({ callId,receiverId,type,callerName }) => {

//     console.log(`Call ended: ${callId}`);
//     io.to(receiverId).emit("callEnded", { callId });
//     if(type === "user"){
//         const store = await db.store.findFirst({where:{
//             id: receiverId
//           }})
//           const storeManager:any = await db.storeManager.findUnique({
//             where:{
//                 id:store?.storeManagerId
//             }
//           })
//           if (!store || !storeManager.notificationToken || !storeManager) {
//             console.error(`User not found for id: ${receiverId}`);
//             return;
//         }
//         const response = await sendHangUpNotificationStoreManager(storeManager.notificationToken,callId,receiverId );
//         console.log("Push notification sent:", response)

//     }
//     if(type === "storeManager"){
//         const user = await db.user.findUnique({ where: { id: receiverId } });
//         if (!user || !user.notificationToken) {
//             console.error(`User not found for id: ${receiverId}`);
//             return;
//         }
//         const response = await sendHangUpNotification(user.notificationToken,callId,receiverId );
//         console.log("Push notification sent:", response)
//     }
// });
