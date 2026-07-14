import express from "express";
import { adminRouter } from "./routes/admin.js";
import { usersRouter } from "./routes/users.js";

const app = express();
app.use("/api", usersRouter);
app.use("/api", adminRouter);

export { app };
